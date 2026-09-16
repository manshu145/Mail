import { desc, ilike, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { contacts, suppressions } from "@/db/schema";
import { authenticateApiKey } from "@/lib/api-keys";
import { isValidEmail, normalizeEmail } from "@/lib/contact-utils";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const key = await authenticateApiKey(request, "contacts:read");
  if (!key) return NextResponse.json({ error: "Invalid API key or scope" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "50")));
  const rows = await db.select().from(contacts).where(q ? or(ilike(contacts.email, `%${q}%`), ilike(contacts.firstName, `%${q}%`), ilike(contacts.lastName, `%${q}%`)) : undefined).orderBy(desc(contacts.createdAt)).limit(limit);
  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const key = await authenticateApiKey(request, "contacts:write");
  if (!key) return NextResponse.json({ error: "Invalid API key or scope" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { email?: string; firstName?: string; lastName?: string } | null;
  const email = String(body?.email || "").trim();
  if (!isValidEmail(email)) return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  const normalizedEmail = normalizeEmail(email);
  const [suppressed] = await db.select({ id: suppressions.id }).from(suppressions).where(eq(suppressions.normalizedEmail, normalizedEmail)).limit(1);
  if (suppressed) return NextResponse.json({ error: "Address is globally suppressed" }, { status: 409 });
  const inserted = await db.insert(contacts).values({ email, normalizedEmail, firstName: String(body?.firstName || "").trim() || null, lastName: String(body?.lastName || "").trim() || null, source: "api" }).onConflictDoNothing({ target: contacts.normalizedEmail }).returning();
  if (!inserted.length) return NextResponse.json({ error: "Contact already exists" }, { status: 409 });
  return NextResponse.json({ data: inserted[0] }, { status: 201 });
}
