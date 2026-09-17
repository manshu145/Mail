import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { suppressions, type lists } from "@/db/schema";
import { resolveAudienceRecipients, type AudienceRecipient } from "@/lib/audience";

export type AudiencePreflightResult = {
  rawCount: number;
  eligibleCount: number;
  suppressedCount: number;
  invalidCount: number;
  validCount: number;
  pendingCount: number;
  unknownCount: number;
  eligibleRecipients: AudienceRecipient[];
};

const SUPPRESSION_LOOKUP_BATCH = 5000;

async function loadSuppressedEmails(normalized: string[]) {
  const blocked = new Set<string>();
  for (let offset = 0; offset < normalized.length; offset += SUPPRESSION_LOOKUP_BATCH) {
    const chunk = normalized.slice(offset, offset + SUPPRESSION_LOOKUP_BATCH);
    if (!chunk.length) continue;
    const rows = await db.select({ normalizedEmail: suppressions.normalizedEmail })
      .from(suppressions)
      .where(inArray(suppressions.normalizedEmail, chunk));
    for (const row of rows) blocked.add(row.normalizedEmail);
  }
  return blocked;
}

export async function preflightAudience(list: typeof lists.$inferSelect): Promise<AudiencePreflightResult> {
  const candidates = await resolveAudienceRecipients(list);
  if (!candidates.length) {
    return { rawCount: 0, eligibleCount: 0, suppressedCount: 0, invalidCount: 0, validCount: 0, pendingCount: 0, unknownCount: 0, eligibleRecipients: [] };
  }

  // Never build a single massive IN (...) predicate. Large lists can contain
  // hundreds of thousands of contacts and PostgreSQL/driver parameter limits
  // would otherwise make campaign preflight fail before any mail is queued.
  const normalized = [...new Set(candidates.map((row) => row.normalizedEmail))];
  const blocked = await loadSuppressedEmails(normalized);

  let suppressedCount = 0;
  let invalidCount = 0;
  let validCount = 0;
  let pendingCount = 0;
  let unknownCount = 0;
  const eligibleRecipients: AudienceRecipient[] = [];

  for (const recipient of candidates) {
    if (blocked.has(recipient.normalizedEmail)) {
      suppressedCount++;
      continue;
    }
    if (recipient.validationStatus === "invalid") {
      invalidCount++;
      continue;
    }
    if (recipient.validationStatus === "valid" || recipient.validationStatus === "accepted") validCount++;
    else if (recipient.validationStatus === "pending") pendingCount++;
    else unknownCount++;
    eligibleRecipients.push(recipient);
  }

  return {
    rawCount: candidates.length,
    eligibleCount: eligibleRecipients.length,
    suppressedCount,
    invalidCount,
    validCount,
    pendingCount,
    unknownCount,
    eligibleRecipients,
  };
}
