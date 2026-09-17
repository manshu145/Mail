import { sql } from "drizzle-orm";
import { db } from "@/db";
import { type lists } from "@/db/schema";
import { audienceSelection } from "@/lib/audience";

export type AudiencePreflightResult = {
  rawCount: number; eligibleCount: number; suppressedCount: number; invalidCount: number;
  validCount: number; pendingCount: number; unknownCount: number;
};

export async function preflightAudience(list: typeof lists.$inferSelect): Promise<AudiencePreflightResult> {
  const selection = await audienceSelection(list);
  const result = await db.execute(sql`with audience as (${selection}) select
    count(*)::int as raw_count,
    count(*) filter(where not suppressed and validation_status<>'invalid')::int as eligible_count,
    count(*) filter(where suppressed)::int as suppressed_count,
    count(*) filter(where not suppressed and validation_status='invalid')::int as invalid_count,
    count(*) filter(where not suppressed and validation_status in ('valid','accepted'))::int as valid_count,
    count(*) filter(where not suppressed and validation_status='pending')::int as pending_count,
    count(*) filter(where not suppressed and validation_status in ('unknown','error'))::int as unknown_count from audience`);
  const row = result.rows[0] as Record<string, unknown>;
  return { rawCount: Number(row.raw_count), eligibleCount: Number(row.eligible_count), suppressedCount: Number(row.suppressed_count),
    invalidCount: Number(row.invalid_count), validCount: Number(row.valid_count), pendingCount: Number(row.pending_count), unknownCount: Number(row.unknown_count) };
}
