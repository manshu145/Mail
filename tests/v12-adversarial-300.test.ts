import assert from "node:assert/strict";
import test from "node:test";
import { decideAdaptiveDelivery } from "../src/lib/adaptive-delivery";
import { classifyDeliveryRestriction, providerForEmail } from "../src/lib/provider";
import { classifyBounce } from "../src/lib/bounce-classification";
import { classifyGmailRcptResponse, validationAllowsSend } from "../src/lib/validation-policy";
import { classifyTrackingRequest, qualifyOpenEvent } from "../src/lib/tracking-classification";
import { scanCampaignContent } from "../src/lib/content-preflight";

const config = {
  initialBatch: 100,
  secondBatch: 300,
  thirdBatch: 600,
  bounceWarnRate: 0.03,
  bounceStopRate: 0.05,
  reputationMinSample: 100,
};

function address(domain: string, index: number) {
  return `case${index}@${domain}`;
}

/**
 * V1.2 adversarial matrix.
 *
 * This intentionally creates 300 deterministic cases rather than a handful of
 * happy-path assertions. The target is to catch boundary mistakes in validation,
 * provider circuit-breaking, bounce suppression, adaptive release, tracking
 * qualification and content safety before live certification.
 */

const mailboxDomains = [
  "gmail.com","googlemail.com","yahoo.com","yahoo.co.in","ymail.com","rocketmail.com",
  "outlook.com","hotmail.com","hotmail.co.in","live.com","msn.com","proton.me","pm.me",
  "protonmail.com","rediffmail.com","rediff.com","mail.com","zoho.com","zohomail.com",
  "zoho.in","zohomail.in","example.com","company.in","custom-domain.test","tenant.example",
  "mailhostbox.com","titan.email","netcore.co.in","secureserver.net","mailcore.net",
];

for (let i = 1; i <= 40; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} validation positive-state matrix ${i}`, () => {
    const status = i % 2 === 0 ? "valid" : "accepted";
    assert.equal(validationAllowsSend(address(mailboxDomains[i % mailboxDomains.length], i), status), true);
  });
}

for (let i = 41; i <= 70; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} validation inconclusive/unsafe state ${i}`, () => {
    const status = (["unknown","error","pending","invalid"] as const)[i % 4];
    assert.equal(validationAllowsSend(address(mailboxDomains[i % mailboxDomains.length], i), status), false);
  });
}

for (let i = 71; i <= 100; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} Gmail RCPT classification boundary ${i}`, () => {
    const mode = i % 5;
    if (mode === 0) {
      assert.equal(classifyGmailRcptResponse(250, "250 2.1.5 OK").status, "accepted");
    } else if (mode === 1) {
      assert.equal(classifyGmailRcptResponse(251, "251 User not local").status, "accepted");
    } else if (mode === 2) {
      assert.equal(classifyGmailRcptResponse(421, "421 4.7.0 temporary rate limit").status, "unknown");
    } else if (mode === 3) {
      assert.equal(classifyGmailRcptResponse(550, "550 5.1.1 user unknown").status, "invalid");
    } else {
      assert.equal(classifyGmailRcptResponse(550, "550 5.7.1 policy rejection").status, "unknown");
    }
  });
}

for (let i = 101; i <= 150; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} provider classification ${i}`, () => {
    const domains = [
      ["gmail.com","gmail"],["googlemail.com","gmail"],["yahoo.com","yahoo"],["yahoo.co.in","yahoo"],
      ["ymail.com","yahoo"],["rocketmail.com","yahoo"],["aol.com","yahoo"],["outlook.com","microsoft"],
      ["hotmail.com","microsoft"],["live.com","microsoft"],["proton.me","proton"],["pm.me","proton"],
      ["rediffmail.com","rediff"],["rediff.com","rediff"],["mail.com","mailcom"],["zoho.com","zoho"],
      ["zohomail.in","zoho"],["custom.test",`domain:custom.test`],
    ] as const;
    const [domain, expected] = domains[i % domains.length];
    assert.equal(providerForEmail(address(domain, i)), expected);
  });
}

for (let i = 151; i <= 180; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} restriction scope matrix ${i}`, () => {
    const mode = i % 3;
    if (mode === 0) {
      const r = classifyDeliveryRestriction(`421 4.7.0 rate limit exceeded case=${i}`, "4.7.0");
      assert.equal(r.scope, "provider");
    } else if (mode === 1) {
      const r = classifyDeliveryRestriction(`550 5.7.1 JFE050007 unusual number of invalid recipients originating from your account case=${i}`, "5.7.1");
      assert.equal(r.scope, "upstream");
    } else {
      const r = classifyDeliveryRestriction(`452 4.2.2 mailbox full case=${i}`, "4.2.2");
      assert.equal(r.scope, "none");
    }
  });
}

for (let i = 181; i <= 210; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} bounce classification matrix ${i}`, () => {
    const mode = i % 5;
    if (mode === 0) {
      const r = classifyBounce("5.1.1", `550 5.1.1 user unknown case=${i}`);
      assert.equal(r.suppressRecipient, true);
    } else if (mode === 1) {
      const r = classifyBounce("5.7.1", `554 5.7.1 rejected due to policy case=${i}`);
      assert.equal(r.suppressRecipient, false);
      assert.equal(r.providerPressure, false);
    } else if (mode === 2) {
      const r = classifyBounce("4.7.0", `421 temporary rate limit case=${i}`);
      assert.equal(r.providerPressure, true);
    } else if (mode === 3) {
      const r = classifyBounce("4.2.2", `452 mailbox full case=${i}`);
      assert.equal(r.providerPressure, false);
    } else {
      const r = classifyBounce("5.0.0", `550 recipient address rejected case=${i}`);
      assert.equal(r.suppressRecipient, false);
    }
  });
}

for (let i = 211; i <= 250; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} adaptive delivery boundary ${i}`, () => {
    const total = [20, 94, 99, 100, 101, 300, 301, 600, 601, 5000][i % 10];
    const unhealthy = i % 4 === 0;
    const released = Math.min(total, 100);
    const minimumSafetySample = Math.min(total, 100);
    const sample = unhealthy ? minimumSafetySample : Math.min(released, Math.max(20, Math.ceil(released * 0.9)));
    const bounced = unhealthy ? Math.ceil(sample * 0.10) : Math.min(1, Math.floor(sample * 0.01));
    const result = decideAdaptiveDelivery({
      total,
      released,
      sample,
      bounced,
      phase: 0,
      releaseLimit: Math.min(total, 100),
      config,
    });
    if (unhealthy && released < total) {
      assert.equal(result.paused, true);
      assert.equal(result.reason, "hard_bounce_rate_stop");
    } else {
      assert.equal(result.paused, false);
    }
  });
}

for (let i = 251; i <= 270; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} tracking qualification boundary ${i}`, () => {
    const ua = i % 4 === 0 ? "Proofpoint URL Defense Scanner" : i % 4 === 1 ? "GoogleImageProxy" : "Mozilla/5.0";
    const classification = classifyTrackingRequest(new Request("https://mail.example.com/tracking/open/token", {
      headers: { "user-agent": ua, "x-forwarded-for": `203.0.113.${Math.max(1, i - 250)}` },
    }));
    const sameIp = i % 5 === 0 ? 10 : 1;
    const result = qualifyOpenEvent(classification, {
      deliveredAt: new Date("2026-09-22T10:00:00Z"),
      eventAt: i % 6 === 0 ? new Date("2026-09-22T09:59:59Z") : new Date("2026-09-22T10:00:05Z"),
      sameIpDistinctRecipients: sameIp,
    });
    if (i % 6 === 0 || i % 4 === 0 || (sameIp >= 10 && !classification.proxyProvider)) {
      assert.equal(result.qualified, false);
    }
  });
}

for (let i = 271; i <= 300; i++) {
  test(`AUDIT-${String(i).padStart(3, "0")} content safety matrix ${i}`, () => {
    const mode = i % 6;
    const result = mode === 0
      ? scanCampaignContent({ subject: "", html: "", text: "" })
      : mode === 1
        ? scanCampaignContent({ subject: "Hello", html: '<script>alert(1)</script>', text: "Hello" })
        : mode === 2
          ? scanCampaignContent({ subject: "Hello", html: '<a href="https://bit.ly/example">Offer</a>', text: "Offer" })
          : mode === 3
            ? scanCampaignContent({ subject: "Hello", html: '<a href="https://example.com/file.exe">Download</a>', text: "Download" })
            : mode === 4
              ? scanCampaignContent({ subject: "Hello", html: '<a href="https://example.com">https://evil.example</a>', text: "Visit" })
              : scanCampaignContent({ subject: "Normal update", html: "<p>Hello</p>", text: "Hello" });
    if (mode === 0 || mode === 1 || mode === 3 || mode === 4) {
      assert.equal(result.status, "blocked");
    } else {
      assert.notEqual(result.status, "blocked");
    }
  });
}
