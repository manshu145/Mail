import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { seedInboxes } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";
import { isValidEmail } from "@/lib/contact-utils";
import { isUuid } from "@/lib/id";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  return NextResponse.json({ seeds: await db.select().from(seedInboxes).orderBy(desc(seedInboxes.createdAt)) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const email = String(body?.email || "").trim().toLowerCase();
  const provider = String(body?.provider || "other");
  const label = String(body?.label || "").trim() || null;
  if (!isValidEmail(email)) return NextResponse.json({ error: "Enter a valid seed email." }, { status: 400 });
  if (!["gmail", "outlook", "other"].includes(provider)) return NextResponse.json({ error: "Provider must be gmail, outlook or other." }, { status: 400 });
  try {
    const [seed] = await db.insert(seedInboxes).values({ email, provider: provider as "gmail" | "outlook" | "other", label }).returning();
    return NextResponse.json({ ok: true, seed });
  } catch {
    return NextResponse.json({ error: "That seed email is already registered." }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = String(body?.id || "");
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid seed id." }, { status: 400 });
  const [seed] = await db.update(seedInboxes).set({ active: body?.active !== false }).where(eq(seedInboxes.id, id)).returning();
  if (!seed) return NextResponse.json({ error: "Seed not found." }, { status: 404 });
  return NextResponse.json({ ok: true, seed });
}
