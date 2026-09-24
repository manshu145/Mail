import { resolveMx } from "node:dns/promises";
import { isValidEmail, normalizeEmail } from "@/lib/contact-utils";
import type { ValidationVerdict } from "@/lib/validation-policy";

type MxLookup =
  | { records: Array<{ exchange: string; priority: number }>; errorCode: null }
  | { records: null; errorCode: string };

const mxCache = new Map<string, { expiresAt: number; value: MxLookup }>();
const mxCacheTtlMs = Math.max(60_000, Number(process.env.VALIDATION_MX_CACHE_TTL_MS || "900000"));
const mxNegativeCacheTtlMs = Math.max(30_000, Number(process.env.VALIDATION_MX_NEGATIVE_CACHE_TTL_MS || "300000"));

async function cachedMxLookup(domain: string): Promise<MxLookup> {
  const key = domain.trim().toLowerCase();
  const cached = mxCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: MxLookup;
  let ttl = mxCacheTtlMs;
  const dnsTimeoutMs = Math.max(1000, Math.min(30_000, Number(process.env.VALIDATION_DNS_TIMEOUT_MS || "5000")));
  try {
    const records = await Promise.race([
      resolveMx(key),
      new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("MX lookup timeout"), { code: "ETIMEOUT" })), dnsTimeoutMs)),
    ]);
    value = { records, errorCode: null };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
    value = { records: null, errorCode: code || "lookup_failed" };
    ttl = mxNegativeCacheTtlMs;
  }

  mxCache.set(key, { expiresAt: Date.now() + ttl, value });
  if (mxCache.size > 10_000) {
    const now = Date.now();
    for (const [cacheKey, entry] of mxCache) {
      if (entry.expiresAt <= now) mxCache.delete(cacheKey);
      if (mxCache.size <= 8_000) break;
    }
  }
  return value;
}

/**
 * Safety boundary: the validation worker must never perform recipient-level
 * SMTP probing from the campaign/validation sending IP. RCPT TO probing can
 * expose that IP to anti-abuse systems and can trigger provider restrictions
 * when a list contains stale/invalid addresses.
 *
 * Internal validation is intentionally limited to syntax + DNS/MX health.
 * Mailbox-level verdicts must come from an external validation provider or
 * from actual delivery bounces.
 */
export async function validateMailboxInternally(emailInput: string): Promise<ValidationVerdict> {
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) return { status: "invalid", detail: "invalid_email_syntax" };

  const domain = email.split("@")[1] || "";
  const lookup = await cachedMxLookup(domain);
  if (!lookup.records) {
    if (lookup.errorCode === "ENODATA" || lookup.errorCode === "ENOTFOUND") {
      return { status: "invalid", detail: "recipient_domain_no_mx" };
    }
    return { status: "unknown", detail: `recipient_domain_dns_error:${lookup.errorCode}` };
  }

  const hosts = lookup.records
    .filter((record) => record.exchange && record.exchange !== ".")
    .sort((a, b) => a.priority - b.priority)
    .map((record) => record.exchange.replace(/\.$/, ""));

  if (!hosts.length) return { status: "invalid", detail: "recipient_domain_null_or_no_mx" };

  return { status: "unknown", detail: "mx_present_mailbox_unverified" };
}

export function classifyMailboxRcptResponse(_code: number, _line: string): ValidationVerdict {
  return { status: "unknown", detail: "smtp_recipient_probe_disabled" };
}
