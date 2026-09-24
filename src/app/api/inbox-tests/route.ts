import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, contactLists, contacts, lists } from "@/db/schema";
import { inboxTestResults, inboxTests, seedInboxes } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/id";
import { isValidEmail } from "@/lib/contact-utils";

const categories = new Set(["inbox", "promotions", "updates", "spam", "not_found"]);

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const tests = await db.select().from(inboxTests).orderBy(desc(inboxTests.createdAt)).limit(50);
  const results = tests.length
    ? await db.select().from(inboxTestResults).where(inArray(inboxTestResults.testId, tests.map((test) => test.id)))
    : [];
  return NextResponse.json({ tests, results });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = String(body?.name || "").trim();
  const campaignId = String(body?.campaignId || "").trim();
  const seedIds = Array.isArray(body?.seedInboxIds) ? body?.seedInboxIds.map(String).filter(Boolean) : [];

  if (!name) return NextResponse.json({ error: "Test name is required." }, { status: 400 });
  if (!isUuid(campaignId)) return NextResponse.json({ error: "Valid campaignId is required." }, { status: 400 });
  if (!seedIds.length || seedIds.some((id) => !isUuid(id))) return NextResponse.json({ error: "Select at least one active seed inbox." }, { status: 400 });

  const [sourceCampaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!sourceCampaign || !sourceCampaign.templateId || !sourceCampaign.sendingAccountId) {
    return NextResponse.json({ error: "Selected campaign is missing a template or sending account." }, { status: 409 });
  }

  const seeds = await db.select().from(seedInboxes).where(and(eq(seedInboxes.active, true), inArray(seedInboxes.id, seedIds)));
  if (seeds.length !== seedIds.length) return NextResponse.json({ error: "One or more selected seed inboxes are inactive or missing." }, { status: 400 });
  if (seeds.some((seed) => !isValidEmail(seed.email))) return NextResponse.json({ error: "A seed inbox has an invalid email address." }, { status: 400 });

  try {
    const created = await db.transaction(async (tx) => {
      const [test] = await tx.insert(inboxTests).values({ name, campaignId, status: "running" }).returning();
      const listName = "__seed_test_" + test.id;
      const [seedList] = await tx.insert(lists).values({ name: listName, description: "NexiMail seed placement test " + test.id }).returning();

      for (const seed of seeds) {
        const normalizedEmail = seed.email.trim().toLowerCase();
        const existing = await tx.select().from(contacts).where(eq(contacts.normalizedEmail, normalizedEmail)).limit(1);
        let contactId: string;
        if (existing[0]) {
          if (existing[0].consentStatus !== "confirmed" || existing[0].status !== "active") {
            throw new Error("Seed " + seed.email + " already exists as an ineligible contact. Confirm consent/active status before testing.");
          }
          contactId = existing[0].id;
        } else {
          const [contact] = await tx.insert(contacts).values({
            email: seed.email,
            normalizedEmail,
            firstName: seed.label || "Seed",
            status: "active",
            validationStatus: "valid",
            source: "seed-test",
            consentStatus: "confirmed",
            consentSource: "seed-test",
          }).returning();
          contactId = contact.id;
        }
        await tx.insert(contactLists).values({ contactId, listId: seedList.id }).onConflictDoNothing();
      }

      const [testCampaign] = await tx.insert(campaigns).values({
        name: "[Seed Test] " + name,
        subject: sourceCampaign.subject,
        preheader: sourceCampaign.preheader,
        fromName: sourceCampaign.fromName,
        fromEmail: sourceCampaign.fromEmail,
        templateId: sourceCampaign.templateId,
        listId: seedList.id,
        sendingAccountId: sourceCampaign.sendingAccountId,
        status: "queued",
        trackOpens: false,
        trackClicks: false,
      }).returning();

      await tx.insert(inboxTestResults).values(seeds.map((seed) => ({
        testId: test.id,
        seedInboxId: seed.id,
        category: "not_found" as const,
        detail: "Awaiting placement observation.",
      })));

      return { test, testCampaign };
    });

    return NextResponse.json({ ok: true, testId: created.test.id, campaignId: created.testCampaign.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create seed test." }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const testId = String(body?.testId || "");
  const seedInboxId = String(body?.seedInboxId || "");
  const category = String(body?.category || "");
  const detail = String(body?.detail || "").trim() || null;

  if (!isUuid(testId) || !isUuid(seedInboxId) || !categories.has(category)) {
    return NextResponse.json({ error: "Valid test, seed inbox and placement category are required." }, { status: 400 });
  }

  const [test] = await db.select().from(inboxTests).where(eq(inboxTests.id, testId)).limit(1);
  if (!test) return NextResponse.json({ error: "Seed test not found." }, { status: 404 });

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

  const results = await db.select().from(inboxTestResults).where(eq(inboxTestResults.testId, testId));
  if (results.length > 0 && results.every((row) => row.category !== "not_found")) {
    await db.update(inboxTests).set({ status: "completed", completedAt: new Date() }).where(eq(inboxTests.id, testId));
  }
  return NextResponse.json({ ok: true });
}
