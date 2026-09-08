import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, or } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { contacts, importJobs, suppressions } from "@/db/schema";
import { importStagingRows } from "@/db/import-schema";
import { getSession } from "@/lib/auth";
import { isValidEmail, normalizeEmail, type ImportRow } from "@/lib/contact-utils";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ configured: false, contacts: [] });
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const rows = await db.select().from(contacts).where(q ? or(ilike(contacts.email, `%${q}%`), ilike(contacts.firstName, `%${q}%`), ilike(contacts.lastName, `%${q}%`)) : undefined).orderBy(desc(contacts.createdAt)).limit(100);
  return NextResponse.json({ configured: true, contacts: rows });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database is not configured for this preview." }, { status: 503 });
  const body = await request.json().catch(() => null) as { mode?: string; contact?: ImportRow; rows?: ImportRow[]; filename?: string } | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  if (body.mode === "single") {
    const item = body.contact;
    if (!item || !isValidEmail(item.email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    const normalizedEmail = normalizeEmail(item.email);
    const [suppressed] = await db.select({ id: suppressions.id }).from(suppressions).where(eq(suppressions.normalizedEmail, normalizedEmail)).limit(1);
    if (suppressed) return NextResponse.json({ error: "This address is globally suppressed." }, { status: 409 });
    const inserted = await db.insert(contacts).values({ email: item.email.trim(), normalizedEmail, firstName: item.firstName?.trim() || null, lastName: item.lastName?.trim() || null, source: "manual" }).onConflictDoNothing({ target: contacts.normalizedEmail }).returning({ id: contacts.id });
    if (!inserted.length) return NextResponse.json({ error: "Contact already exists." }, { status: 409 });
    return NextResponse.json({ ok: true, id: inserted[0].id }, { status: 201 });
  }

  if (body.mode === "bulk") {
    if (!Array.isArray(body.rows) || !body.rows.length) return NextResponse.json({ error: "No rows found." }, { status: 400 });
    if (body.rows.length > 5000) return NextResponse.json({ error: "A single import job supports up to 5,000 rows. Split larger files into multiple jobs." }, { status: 413 });
    const jobRows = await db.insert(importJobs).values({ filename: body.filename?.slice(0, 200) || "contacts.csv", status: "pending", totalRows: body.rows.length, createdBy: /^[0-9a-f-]{36}$/i.test(session.userId) ? session.userId : null }).returning({ id: importJobs.id });
    const jobId = jobRows[0].id;
    await db.insert(importStagingRows).values(body.rows.map((payload, index) => ({ jobId, rowNumber: index + 2, payload })));
    return NextResponse.json({ ok: true, queued: true, jobId, total: body.rows.length }, { status: 202 });
  }

  return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
}
