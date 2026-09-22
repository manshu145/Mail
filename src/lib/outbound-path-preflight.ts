import net from "node:net";
import { resolveMx } from "node:dns/promises";
import { classifyDeliveryRestriction } from "@/lib/provider";

export type SmtpBannerProbe = {
  domain: string;
  host: string | null;
  ok: boolean;
  banner: string | null;
  error: string | null;
  restriction: boolean;
};

export type OutboundPathPreflight = {
  status: "ready" | "warning" | "blocked";
  checkedAt: string;
  probes: SmtpBannerProbe[];
  issue: string | null;
};

const cache = new Map<string, { expiresAt: number; value: OutboundPathPreflight }>();

export function classifySmtpBanner(banner: string) {
  const restriction = classifyDeliveryRestriction(banner);
  return {
    ready: /^220(?:\s|-)/.test(banner.trim()),
    restricted: restriction.scope === "upstream",
    scope: restriction.scope,
  };
}

async function readBanner(host: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 25 });
    let settled = false;
    const finish = (error: Error | null, value = "") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value.trim().slice(0, 1000));
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("SMTP banner timeout")));
    socket.once("error", (error) => finish(error));
    socket.once("data", (chunk) => finish(null, chunk.toString("utf8")));
  });
}

async function probeDomain(domain: string, timeoutMs: number): Promise<SmtpBannerProbe> {
  try {
    const records = await resolveMx(domain);
    const mx = records.sort((a, b) => a.priority - b.priority)[0];
    if (!mx?.exchange) return { domain, host: null, ok: false, banner: null, error: "No MX host", restriction: false };
    const mxHost = mx.exchange.replace(/\.$/, "");
    const banner = await readBanner(mxHost, timeoutMs);
    const classification = classifySmtpBanner(banner);
    return { domain, host: mxHost, ok: classification.ready, banner, error: null, restriction: classification.restricted };
  } catch (error) {
    return { domain, host: null, ok: false, banner: null, error: error instanceof Error ? error.message.slice(0, 300) : "SMTP probe failed", restriction: false };
  }
}

export async function checkOutboundSmtpPath(env: Readonly<Record<string, string | undefined>> = process.env): Promise<OutboundPathPreflight> {
  const enabled = env.NEXIMAIL_OUTBOUND_PREFLIGHT_ENABLED !== "false";
  if (!enabled) return { status: "warning", checkedAt: new Date().toISOString(), probes: [], issue: "Live outbound SMTP banner checks are disabled." };

  const domains = (env.OUTBOUND_PREFLIGHT_DOMAINS || "gmail.com,yahoo.com,outlook.com,zoho.com")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean).slice(0, 6);
  const key = domains.join(",");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const timeoutMs = Math.min(10_000, Math.max(1_000, Number(env.OUTBOUND_PREFLIGHT_TIMEOUT_MS || "5000")));
  const probes = await Promise.all(domains.map((domain) => probeDomain(domain, timeoutMs)));
  const restricted = probes.filter((probe) => probe.restriction);
  const ready = probes.filter((probe) => probe.ok);
  const strict = env.NEXIMAIL_OUTBOUND_PREFLIGHT_STRICT !== "false";
  const value: OutboundPathPreflight = restricted.length
    ? { status: "blocked", checkedAt: new Date().toISOString(), probes, issue: "Outbound infrastructure returned an account-level SMTP restriction before a message transaction." }
    : ready.length === 0 && strict
      ? { status: "blocked", checkedAt: new Date().toISOString(), probes, issue: "No independent recipient MX returned a usable SMTP banner." }
      : ready.length < Math.min(2, domains.length)
        ? { status: "warning", checkedAt: new Date().toISOString(), probes, issue: "Outbound SMTP path could be confirmed against fewer than two independent MX networks." }
        : { status: "ready", checkedAt: new Date().toISOString(), probes, issue: null };

  cache.set(key, { expiresAt: Date.now() + 120_000, value });
  return value;
}
