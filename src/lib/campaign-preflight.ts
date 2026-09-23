import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { providerCooldowns, workerHeartbeats } from "@/db/operations-schema";
import { readDeliverySettings } from "@/lib/delivery-settings";
import { scanCampaignContent } from "@/lib/content-preflight";
import { checkOutboundSmtpPath } from "@/lib/outbound-path-preflight";
import { getRuntimePolicy } from "@/lib/runtime-policy";
import { UPSTREAM_COOLDOWN_KEY } from "@/lib/provider";
import { providerCooldownEvents } from "@/db/provider-cooldown-event-schema";
import type { AudiencePreflightResult } from "@/lib/audience-preflight";

const CRITICAL_WORKERS = ["campaign", "policy", "transport"] as const;

export type CampaignPreflight = {
  ok: boolean;
  issues: string[];
  workers: Array<{ name: string; online: boolean; ageSeconds: number | null; state: string | null }>;
};

export async function getCampaignPreflight(maxAgeSeconds = 120): Promise<CampaignPreflight> {
  const rows = await db.select().from(workerHeartbeats).where(inArray(workerHeartbeats.workerName, [...CRITICAL_WORKERS]));
  const byName = new Map(rows.map((row) => [row.workerName, row]));
  const now = Date.now();
  const issues: string[] = [];
  const workers = CRITICAL_WORKERS.map((name) => {
    const row = byName.get(name);
    const ageSeconds = row ? Math.max(0, Math.floor((now - row.lastSeenAt.getTime()) / 1000)) : null;
    const state = row && typeof row.metadata?.state === "string" ? row.metadata.state : null;
    const online = Boolean(row && ageSeconds !== null && ageSeconds <= maxAgeSeconds && state !== "error" && state !== "stopped");
    if (!online) issues.push(!row ? `${name} worker has not reported yet` : `${name} worker heartbeat is stale or unhealthy`);
    return { name, online, ageSeconds, state };
  });
  return { ok: issues.length === 0, issues, workers };
}

export type SendGuardCheck = {
  key: "runtime" | "transport" | "sender_auth" | "outbound_path" | "audience" | "content" | "restrictions";
  label: string;
  status: "ready" | "warning" | "blocked";
  detail: string;
  metadata?: Record<string, unknown>;
};

export type CampaignSendGuard = {
  status: "ready" | "warning" | "blocked";
  checkedAt: string;
  checks: SendGuardCheck[];
  blockingIssues: string[];
};

function overall(checks: SendGuardCheck[]): CampaignSendGuard["status"] {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "ready";
}

export async function getCampaignSendGuard(input: {
  sendingAccountId: string;
  fromEmail: string;
  domain: { status: string; spfOk: boolean; dkimOk: boolean; dmarcOk: boolean; bounceStatus?: string | null } | null;
  audience: AudiencePreflightResult;
  subject: string;
  html: string;
  text: string;
  attachmentNames?: string[];
}): Promise<CampaignSendGuard> {
  const [pipeline, delivery, outboundPath, activeRestrictions] = await Promise.all([
    getCampaignPreflight(),
    readDeliverySettings(),
    checkOutboundSmtpPath(),
    db.select().from(providerCooldowns).where(and(
      eq(providerCooldowns.sendingAccountId, input.sendingAccountId),
      eq(providerCooldowns.active, true),
    )),
  ]);
  const runtime = getRuntimePolicy();
  const content = scanCampaignContent({
    subject: input.subject,
    html: input.html,
    text: input.text,
    fromEmail: input.fromEmail,
    attachmentNames: input.attachmentNames,
  });
  const liveUpstreamRestriction = outboundPath.probes.find((probe) => probe.restriction);
  if (liveUpstreamRestriction && !activeRestrictions.some((row) => row.provider === UPSTREAM_COOLDOWN_KEY || row.provider === "__sender__")) {
    const now = new Date();
    const nextProbeAt = new Date(now.getTime() + delivery.providerCooldownMinutes * 60_000);
    const response = String(liveUpstreamRestriction.banner || liveUpstreamRestriction.error || "outbound SMTP banner restriction").slice(0, 1000);
    const [cooldown] = await db.insert(providerCooldowns).values({
      sendingAccountId: input.sendingAccountId,
      provider: UPSTREAM_COOLDOWN_KEY,
      active: true,
      reason: "sender_or_outbound_path_restriction",
      lastResponse: response,
      detectedAt: now,
      nextProbeAt,
      clearedAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [providerCooldowns.sendingAccountId, providerCooldowns.provider],
      set: { active: true, reason: "sender_or_outbound_path_restriction", lastResponse: response, detectedAt: now, nextProbeAt, clearedAt: null, updatedAt: now },
    }).returning();
    if (cooldown) {
      activeRestrictions.push(cooldown);
      await db.insert(providerCooldownEvents).values({
        cooldownId: cooldown.id,
        sendingAccountId: input.sendingAccountId,
        provider: UPSTREAM_COOLDOWN_KEY,
        eventType: "preflight_detected",
        reason: "sender_or_outbound_path_restriction",
        response,
        metadata: { domain: liveUpstreamRestriction.domain, host: liveUpstreamRestriction.host, checkedAt: outboundPath.checkedAt },
      });
    }
  }
  const transport = pipeline.workers.find((worker) => worker.name === "transport");
  const transportRow = await db.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerName, "transport")).limit(1);
  const transportMeta = transportRow[0]?.metadata || {};
  const pollIntervalMs = Number(transportMeta.pollIntervalMs || 0);
  const claimBatch = Number(transportMeta.claimBatch || 0);
  const effectivePerSecond = Number(transportMeta.perSecond || delivery.maxPerSecond);
  const pollingCapacity = pollIntervalMs > 0 && claimBatch > 0 ? claimBatch / (pollIntervalMs / 1000) : effectivePerSecond;
  const throughput = Math.min(effectivePerSecond || Number.POSITIVE_INFINITY, pollingCapacity || Number.POSITIVE_INFINITY);
  let upstream = activeRestrictions.find((row) => row.provider === UPSTREAM_COOLDOWN_KEY || row.provider === "__sender__");
  if (upstream && outboundPath.status === "ready" && outboundPath.probes.filter((probe) => probe.ok).length >= 2) {
    const now = new Date();
    await db.update(providerCooldowns).set({ active: false, clearedAt: now, nextProbeAt: null, lastResponse: "Outbound banner preflight returned normal SMTP greetings.", updatedAt: now }).where(eq(providerCooldowns.id, upstream.id));
    await db.execute(sql`
      update messages set next_attempt_at=${now},last_error=null
      where campaign_id in (select id from campaigns where sending_account_id=${input.sendingAccountId})
        and status='ready_for_transport'
        and (last_error in ('sender_cooldown','upstream_cooldown','provider_cooldown:__sender__','provider_cooldown:__upstream__') or last_error like 'provider_cooldown:%')
    `);
    await db.insert(providerCooldownEvents).values({
      cooldownId: upstream.id,
      sendingAccountId: input.sendingAccountId,
      provider: upstream.provider,
      eventType: "cleared_banner_preflight",
      reason: upstream.reason,
      response: "Normal SMTP greetings observed across independent MX networks.",
      metadata: { checkedAt: outboundPath.checkedAt, successfulNetworks: outboundPath.probes.filter((probe) => probe.ok).map((probe) => probe.domain) },
    });
    upstream = undefined;
  }
  const providerRestrictions = activeRestrictions.filter((row) => row.provider !== UPSTREAM_COOLDOWN_KEY && row.provider !== "__sender__");

  const checks: SendGuardCheck[] = [
    {
      key: "runtime",
      label: "Runtime sending state",
      status: runtime.sendingEnabled && transportMeta.sendingEnabled !== false ? "ready" : "blocked",
      detail: runtime.sendingEnabled && transportMeta.sendingEnabled !== false
        ? `${runtime.mode} mode · sending enabled`
        : "The effective running configuration has sending disabled.",
      metadata: { mode: runtime.mode, configuredSendingEnabled: runtime.sendingEnabled, workerSendingEnabled: transportMeta.sendingEnabled ?? null },
    },
    {
      key: "transport",
      label: "Delivery pipeline",
      status: !pipeline.ok || !transport?.online || throughput < 0.2 ? "blocked" : throughput < 1 ? "warning" : "ready",
      detail: !pipeline.ok
        ? pipeline.issues.join("; ")
        : throughput < 0.2
          ? `Effective transport throughput is only ${Number.isFinite(throughput) ? throughput.toFixed(2) : "unknown"} messages/second.`
          : `Workers healthy · effective capacity ${Number.isFinite(throughput) ? throughput.toFixed(2) : effectivePerSecond.toFixed(2)} messages/second`,
      metadata: { pollIntervalMs, claimBatch, configuredPerSecond: effectivePerSecond, effectiveThroughput: Number.isFinite(throughput) ? throughput : null },
    },
    {
      key: "sender_auth",
      label: "Sender authentication",
      status: input.domain?.status === "ready"
        && input.domain.spfOk
        && input.domain.dkimOk
        && input.domain.dmarcOk
        && input.domain.bounceStatus !== "warning"
          ? "ready"
          : "blocked",
      detail: input.domain?.status === "ready"
        && input.domain.spfOk
        && input.domain.dkimOk
        && input.domain.dmarcOk
        && input.domain.bounceStatus !== "warning"
          ? `SPF, DKIM, DMARC and envelope-from/bounce DNS are ready for ${input.fromEmail.split("@")[1] || input.fromEmail}.`
          : input.domain?.bounceStatus === "warning"
            ? "Bounce/envelope-from domain must have valid SPF authorization and MX routing before launch."
            : "Sending domain must pass SPF, DKIM and DMARC before launch.",
      metadata: input.domain ? { spf: input.domain.spfOk, dkim: input.domain.dkimOk, dmarc: input.domain.dmarcOk, bounceStatus: input.domain.bounceStatus || null } : {},
    },
    {
      key: "outbound_path",
      label: "Outbound SMTP path",
      status: outboundPath.status,
      detail: outboundPath.issue || `${outboundPath.probes.filter((probe) => probe.ok).length} independent MX networks returned usable SMTP banners.`,
      metadata: { checkedAt: outboundPath.checkedAt, probes: outboundPath.probes },
    },
    {
      key: "audience",
      label: "Audience health",
      status: input.audience.eligibleCount === 0 || input.audience.domainHealthPendingCount > 0 || input.audience.pendingCount > 0
        ? "blocked"
        : input.audience.unknownCount > 0 || input.audience.invalidCount > 0 || input.audience.domainInvalidCount > 0
          ? "warning"
          : "ready",
      detail: input.audience.domainHealthPendingCount > 0
        ? `Recipient-domain DNS checks are incomplete for ${input.audience.domainHealthPendingCount.toLocaleString()} domain${input.audience.domainHealthPendingCount === 1 ? "" : "s"}; launch is blocked until they complete.`
        : input.audience.pendingCount > 0
          ? `${input.audience.pendingCount.toLocaleString()} recipient${input.audience.pendingCount === 1 ? "" : "s"} have not completed NexiMail mailbox validation; launch is blocked until validation runs.`
          : `${input.audience.eligibleCount.toLocaleString()} eligible · ${input.audience.suppressedCount.toLocaleString()} suppressed · ${input.audience.invalidCount.toLocaleString()} address-invalid · ${input.audience.domainInvalidCount.toLocaleString()} domain-invalid · ${input.audience.unknownCount.toLocaleString()} inconclusive`,
      metadata: input.audience,
    },
    {
      key: "content",
      label: "Content policy risk",
      status: content.status,
      detail: content.findings.length ? content.findings.map((finding) => finding.message).join(" ") : "No obvious local content-policy risks detected.",
      metadata: { risk: content.risk, score: content.score, findings: content.findings, linkCount: content.linkCount },
    },
    {
      key: "restrictions",
      label: "Active delivery restrictions",
      status: upstream ? "blocked" : providerRestrictions.length ? "warning" : "ready",
      detail: upstream
        ? "Outbound infrastructure is currently restricted; launch is blocked until a controlled probe succeeds."
        : providerRestrictions.length
          ? `${providerRestrictions.length} provider lane${providerRestrictions.length === 1 ? " is" : "s are"} paused; unrelated lanes can continue.`
          : "No active outbound or provider restrictions.",
      metadata: { upstream: upstream?.lastResponse || null, providers: providerRestrictions.map((row) => row.provider) },
    },
  ];
  const status = overall(checks);
  return { status, checkedAt: new Date().toISOString(), checks, blockingIssues: checks.filter((check) => check.status === "blocked").map((check) => check.detail) };
}
