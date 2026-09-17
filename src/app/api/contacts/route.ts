import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, or } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { contacts, suppressions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isValidEmail, normalizeEmail, type ImportRow } from "@/lib/contact-utils";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ configured: false, contacts: [] });
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const rows = await db.select().from(contacts).where(q ? or(ilike(contacts.email, `%${q}%`), ilike(contacts.firstName, `%${q}%`), ilike(contacts.lastName, `%${q}%`), ilike(contacts.consentSource, `%${q}%`)) : undefined).orderBy(desc(contacts.createdAt)).limit(100);
  return NextResponse.json({ configured: true, contacts: rows });
}

function normalizeConsent(item: ImportRow) {
  const consentStatus = item.consentStatus === "confirmed" ? "confirmed" : "unconfirmed";
  const consentSource = item.consentSource?.trim() || null;
  return { consentStatus, consentSource };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Contact storage is unavailable." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { mode?: string; contact?: ImportRow } | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  if (body.mode === "bulk") {
    return NextResponse.json({
      error: "Legacy bulk contact import has been retired. Use the Imports workspace for mapped background CSV imports.",
      importsPath: "/imports",
    }, { status: 410 });
  }

  if (body.mode !== "single") return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });

  const item = body.contact;
  if (!item || !isValidEmail(item.email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const consent = normalizeConsent(item);
  if (consent.consentStatus === "confirmed" && !consent.consentSource) return NextResponse.json({ error: "Consent source is required for confirmed opt-in." }, { status: 400 });
  const normalizedEmail = normalizeEmail(item.email);
  const [suppressed] = await db.select({ id: suppressions.id }).from(suppressions).where(eq(suppressions.normalizedEmail, normalizedEmail)).limit(1);
  if (suppressed) return NextResponse.json({ error: "This address is globally suppressed." }, { status: 409 });

  const inserted = await db.insert(contacts).values({
    email: item.email.trim(),
    normalizedEmail,
    firstName: item.firstName?.trim() || null,
    lastName: item.lastName?.trim() || null,
    source: "manual",
    consentStatus: consent.consentStatus,
    consentSource: consent.consentSource,
  }).onConflictDoNothing({ target: contacts.normalizedEmail }).returning({ id: contacts.id });

  if (!inserted.length) return NextResponse.json({ error: "Contact already exists." }, { status: 409 });
  await audit("contact.created", session, "contact", inserted[0].id, { email: item.email.trim(), consentStatus: consent.consentStatus, consentSource: consent.consentSource });
  return NextResponse.json({ ok: true, id: inserted[0].id }, { status: 201 });
}
