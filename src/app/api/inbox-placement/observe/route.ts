import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { inboxTestResults, inboxTests, seedInboxes } from "@/db/operations-schema";

const CATEGORIES = new Set(["inbox", "promotions", "updates", "spam", "not_found"]);

function authorized(request: NextRequest) {
  const expected = process.env.SEED_AGENT_SECRET?.trim();
  const supplied = request.headers.get("x-neximail-seed-secret")?.trim();
  if (!expected || expected.length < 24 || !supplied || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function text(value: unknown, max: number) {
  return String(value ?? "").replace(/[\r\n\0]+/g, " ").trim().slice(0, max);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const testId = text(body.testId, 64);
  const seedInboxId = text(body.seedInboxId, 64);
  const category = text(body.category, 32);
  const detail = text(body.detail, 1000) || null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuid.test(testId) || !uuid.test(seedInboxId)) return NextResponse.json({ error: "Invalid testId or seedInboxId" }, { status: 400 });
  if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Invalid placement category" }, { status: 400 });

  const [[test], [seed]] = await Promise.all([
    db.select().from(inboxTests).where(eq(inboxTests.id, testId)).limit(1),
    db.select().from(seedInboxes).where(and(eq(seedInboxes.id, seedInboxId), eq(seedInboxes.active, true))).limit(1),
  ]);
  if (!test) return NextResponse.json({ error: "Inbox test not found" }, { status: 404 });
  if (!seed) return NextResponse.json({ error: "Active seed inbox not found" }, { status: 404 });
  if (test.status === "failed" || test.status === "completed") return NextResponse.json({ error: `Inbox test is ${test.status}` }, { status: 409 });

  await db.insert(inboxTestResults).values({
    testId,
    seedInboxId,
    category: category as "inbox" | "promotions" | "updates" | "spam" | "not_found",
    detail,
    observedAt: new Date(),
  }).onConflictDoUpdate({
    target: [inboxTestResults.testId, inboxTestResults.seedInboxId],
    set: { category: category as "inbox" | "promotions" | "updates" | "spam" | "not_found", detail, observedAt: new Date() },
  });

  if (test.status === "draft") await db.update(inboxTests).set({ status: "running" }).where(eq(inboxTests.id, testId));

  const [counts] = await db.select({
    observed: sql<number>`count(distinct ${inboxTestResults.seedInboxId})::int`,
  }).from(inboxTestResults).where(eq(inboxTestResults.testId, testId));
  const [seedCountRow] = await db.select({
    total: sql<number>`count(*)::int`,
  }).from(seedInboxes).where(eq(seedInboxes.active, true));

  const observed = Number(counts?.observed || 0);
  const total = Number(seedCountRow?.total || 0);
  if (total > 0 && observed >= total) {
    await db.update(inboxTests).set({ status: "completed", completedAt: new Date() }).where(eq(inboxTests.id, testId));
  }

  return NextResponse.json({ ok: true, observed, total, completed: total > 0 && observed >= total });
}
