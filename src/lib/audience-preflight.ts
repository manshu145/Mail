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

export async function preflightAudience(list: typeof lists.$inferSelect): Promise<AudiencePreflightResult> {
  const candidates = await resolveAudienceRecipients(list);
  if (!candidates.length) {
    return { rawCount: 0, eligibleCount: 0, suppressedCount: 0, invalidCount: 0, validCount: 0, pendingCount: 0, unknownCount: 0, eligibleRecipients: [] };
  }

  const normalized = [...new Set(candidates.map((row) => row.normalizedEmail))];
  const suppressedRows = normalized.length
    ? await db.select({ normalizedEmail: suppressions.normalizedEmail }).from(suppressions).where(inArray(suppressions.normalizedEmail, normalized))
    : [];
  const blocked = new Set(suppressedRows.map((row) => row.normalizedEmail));

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
    if (recipient.validationStatus === "valid") validCount++;
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
