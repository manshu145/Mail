import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { contacts, importJobs, lists, suppressions } from "@/db/schema";
import { importStagingRows } from "@/db/import-schema";
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

  const body = (await request.json().catch(() => null)) as { mode?: string; contact?: ImportRow; rows?: ImportRow[]; filename?: string } | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  if (body.mode === "single") {
    const item = body.contact;
    if (!item || !isValidEmail(item.email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    const consent = normalizeConsent(item);
    if (consent.consentStatus === "confirmed" && !consent.consentSource) return NextResponse.json({ error: "Consent source is required for confirmed opt-in." }, { status: 400 });
    const normalizedEmail = normalizeEmail(item.email);
    const [suppressed] = await db.select({ id: suppressions.id }).from(suppressions).where(eq(suppressions.normalizedEmail, normalizedEmail)).limit(1);
    if (suppressed) return NextResponse.json({ error: "This address is globally suppressed." }, { status: 409 });

    const inserted = await db.insert(contacts).values({ email: item.email.trim(), normalizedEmail, firstName: item.firstName?.trim() || null, lastName: item.lastName?.trim() || null, source: "manual", consentStatus: consent.consentStatus, consentSource: consent.consentSource }).onConflictDoNothing({ target: contacts.normalizedEmail }).returning({ id: contacts.id });
    if (!inserted.length) return NextResponse.json({ error: "Contact already exists." }, { status: 409 });
    await audit("contact.created", session, "contact", inserted[0].id, { email: item.email.trim(), consentStatus: consent.consentStatus, consentSource: consent.consentSource });
    return NextResponse.json({ ok: true, id: inserted[0].id }, { status: 201 });
  }

  if (body.mode === "bulk") {
    if (!Array.isArray(body.rows) || !body.rows.length) return NextResponse.json({ error: "No rows found." }, { status: 400 });
    if (body.rows.length > 5000) return NextResponse.json({ error: "A single import job supports up to 5,000 rows. Split larger files into multiple jobs." }, { status: 413 });
    const missingConsentSource = body.rows.some((row) => !row.consentSource?.trim());
    if (missingConsentSource) return NextResponse.json({ error: "Every imported row must have an opt-in / consent source." }, { status: 400 });

    const filename = body.filename?.slice(0, 200) || "contacts.csv";
    const createdBy = /^[0-9a-f-]{36}$/i.test(session.userId) ? session.userId : null;
    const result = await db.transaction(async (tx) => {
      const [job] = await tx.insert(importJobs).values({ filename, status: "pending", totalRows: body.rows!.length, createdBy }).returning({ id: importJobs.id });
      const listName = `Import · ${filename.replace(/\.[^.]+$/, "").slice(0, 100) || "Contacts"} · ${job.id.slice(0, 8)}`;
      const [list] = await tx.insert(lists).values({ name: listName, description: `Automatically created from ${filename}`, isDynamic: false }).returning({ id: lists.id, name: lists.name });
      await tx.execute(sql`update import_jobs set list_id=${list.id} where id=${job.id}`);
      await tx.insert(importStagingRows).values(body.rows!.map((payload, index) => ({ jobId: job.id, rowNumber: index + 2, payload })));
      return { jobId: job.id, listId: list.id, listName: list.name };
    });

    await audit("contact_import.queued", session, "import_job", result.jobId, { filename, total: body.rows.length, listId: result.listId, consentSources: [...new Set(body.rows.map((r) => r.consentSource?.trim()).filter(Boolean))].slice(0, 20) });
    return NextResponse.json({ ok: true, queued: true, jobId: result.jobId, listId: result.listId, listName: result.listName, total: body.rows.length }, { status: 202 });
  }

  return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
}
