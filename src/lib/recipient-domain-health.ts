import { resolveMx } from "node:dns/promises";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { recipientDomainHealth } from "@/db/operations-schema";

export type RecipientDomainStatus = "valid" | "no_mx" | "null_mx" | "dns_error";
export type RecipientDomainResult = { domain: string; status: RecipientDomainStatus; mxHosts: string[]; detail: string | null };

const MAX_DOMAINS_PER_PREFLIGHT = 2_000;
const VALID_TTL_MS = 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 5 * 60 * 1000;

export function classifyMxRecords(domain: string, records: Array<{ exchange: string; priority: number }>): RecipientDomainResult {
  if (!records.length) return { domain, status: "no_mx", mxHosts: [], detail: "No MX records found" };
  if (records.some((record) => !record.exchange || record.exchange === ".")) return { domain, status: "null_mx", mxHosts: [], detail: "Domain publishes null MX and does not accept email" };
  return { domain, status: "valid", mxHosts: records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange.toLowerCase().replace(/\.$/, "")), detail: null };
}

async function checkDomain(domain: string): Promise<RecipientDomainResult> {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(domain)) {
    return { domain, status: "no_mx", mxHosts: [], detail: "Invalid recipient domain syntax" };
  }
  try { return classifyMxRecords(domain, await resolveMx(domain)); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
    if (["ENODATA", "ENOTFOUND"].includes(code)) return { domain, status: "no_mx", mxHosts: [], detail: code || "No MX records found" };
    return { domain, status: "dns_error", mxHosts: [], detail: code || (error instanceof Error ? error.message.slice(0, 240) : "DNS lookup failed") };
  }
}

export async function refreshRecipientDomainHealth(inputDomains: string[]) {
  const unique = [...new Set(inputDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
  const selected = unique.slice(0, MAX_DOMAINS_PER_PREFLIGHT);
  const overflowCount = Math.max(0, unique.length - selected.length);
  const cached: typeof recipientDomainHealth.$inferSelect[] = [];
  for (let offset = 0; offset < selected.length; offset += 500) {
    const chunk = selected.slice(offset, offset + 500);
    if (chunk.length) cached.push(...await db.select().from(recipientDomainHealth).where(inArray(recipientDomainHealth.domain, chunk)));
  }
  const byDomain = new Map(cached.map((row) => [row.domain, row]));
  const now = Date.now();
  const pending = selected.filter((domain) => {
    const row = byDomain.get(domain);
    if (!row) return true;
    const ttl = row.status === "dns_error" ? ERROR_TTL_MS : VALID_TTL_MS;
    return now - row.checkedAt.getTime() > ttl;
  });

  const checked: RecipientDomainResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(20, pending.length) }, async () => {
    while (cursor < pending.length) {
      const domain = pending[cursor++];
      checked.push(await checkDomain(domain));
    }
  });
  await Promise.all(workers);
  for (const result of checked) {
    const checkedAt = new Date();
    await db.insert(recipientDomainHealth).values({ domain: result.domain, status: result.status, mxHosts: result.mxHosts, detail: result.detail, checkedAt, updatedAt: checkedAt })
      .onConflictDoUpdate({ target: recipientDomainHealth.domain, set: { status: result.status, mxHosts: result.mxHosts, detail: result.detail, checkedAt, updatedAt: checkedAt } });
    byDomain.set(result.domain, { domain: result.domain, status: result.status, mxHosts: result.mxHosts, detail: result.detail, checkedAt, updatedAt: checkedAt });
  }

  const rows = selected.map((domain) => byDomain.get(domain)).filter(Boolean) as typeof recipientDomainHealth.$inferSelect[];
  return {
    checkedDomains: selected.length,
    overflowCount,
    noMxDomains: rows.filter((row) => row.status === "no_mx" || row.status === "null_mx").length,
    pendingDomains: overflowCount + rows.filter((row) => row.status === "dns_error").length,
  };
}
