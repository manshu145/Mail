import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, databaseConfigured, pool } from "@/db";
import { contacts, importJobs, systemSettings, validationJobs } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isValidEmail, normalizeEmail } from "@/lib/contact-utils";
import { decryptWorkspaceSecret } from "@/lib/secure-setting";

const gmailSql = sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com$'`;
const unresolved = inArray(contacts.validationStatus, ["pending","unknown","error"]);

async function activeJob() {
  const [job] = await db.select().from(validationJobs)
    .where(inArray(validationJobs.status, ["pending","processing"]))
    .orderBy(validationJobs.createdAt).limit(1);
  return job || null;
}

async function setPaused(paused: boolean) {
  await db.insert(systemSettings).values({ key: "validation_paused", value: paused })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: paused, updatedAt: new Date() } });
}

async function validationProviderConfigured() {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings)
    .where(eq(systemSettings.key, "validation.supersend_api_key")).limit(1);
  return Boolean(decryptWorkspaceSecret(row?.value) || String(process.env.SUPERSEND_API_KEY || "").trim());
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => null) as {
    action?: "start_pending" | "start_import" | "start_single" | "pause" | "resume";
    importId?: string;
    email?: string;
  } | null;
  if (!body?.action) return NextResponse.json({ error: "Action is required." }, { status: 400 });

  if (body.action === "pause") {
    await setPaused(true);
    await audit("validation.paused", session, "validation", undefined, {});
    return NextResponse.json({ ok: true, paused: true });
  }
  if (body.action === "resume") {
    await setPaused(false);
    await audit("validation.resumed", session, "validation", undefined, {});
    return NextResponse.json({ ok: true, paused: false });
  }

  if (!(await validationProviderConfigured())) {
    return NextResponse.json({ error: "Configure the Supersend API key in Validation before starting a validation job." }, { status: 409 });
  }

  const active = await activeJob();
  if (active) return NextResponse.json({
    error: "A validation job is already active. Pause/resume that job or wait for it to finish.",
    activeJob: { id: active.id, scope: active.scope, status: active.status, totalRows: active.totalRows, processedRows: active.processedRows },
  }, { status: 409 });

  await setPaused(false);

  if (body.action === "start_pending") {
    const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(contacts)
      .where(and(eq(contacts.status, "active"), gmailSql, unresolved));
    const total = row?.value ?? 0;
    if (!total) return NextResponse.json({ error: "No unresolved Gmail / Googlemail contacts need validation." }, { status: 409 });
    const [job] = await db.insert(validationJobs).values({ scope: "gmail:unresolved", totalRows: total }).returning({ id: validationJobs.id });
    await audit("validation.queued", session, "validation_job", job.id, { scope: "gmail:unresolved", total });
    return NextResponse.json({ ok: true, id: job.id, total });
  }

  if (body.action === "start_import") {
    const importId = String(body.importId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(importId)) return NextResponse.json({ error: "Choose a valid import." }, { status: 400 });
    const [imp] = await db.select({ id: importJobs.id }).from(importJobs).where(eq(importJobs.id, importId)).limit(1);
    if (!imp) return NextResponse.json({ error: "Import not found." }, { status: 404 });

    const result = await pool.query<{ total: number }>(`
      select count(distinct c.id)::int as total
      from import_staging_rows s
      join contacts c on c.id=s.contact_id
      where s.job_id=$1
        and c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and lower(c.normalized_email) ~ '@(gmail|googlemail)\\.com$'
    `, [importId]);
    const total = Number(result.rows[0]?.total || 0);
    if (!total) return NextResponse.json({ error: "This import has no unresolved Gmail contacts to validate." }, { status: 409 });

    const [job] = await db.insert(validationJobs).values({ scope: `import:${importId}`, totalRows: total }).returning({ id: validationJobs.id });
    await audit("validation.queued", session, "validation_job", job.id, { scope: `import:${importId}`, total });
    return NextResponse.json({ ok: true, id: job.id, total });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!isValidEmail(email) || !/@(gmail|googlemail)\.com$/i.test(email)) {
    return NextResponse.json({ error: "Enter a Gmail or Googlemail address that already exists in Contacts." }, { status: 400 });
  }
  const normalized = normalizeEmail(email);
  const [contact] = await db.select({ id: contacts.id, email: contacts.email, status: contacts.status, validationStatus: contacts.validationStatus })
    .from(contacts).where(eq(contacts.normalizedEmail, normalized)).limit(1);
  if (!contact) return NextResponse.json({ error: "Contact not found. Add/import it first, then validate." }, { status: 404 });
  if (contact.status !== "active") return NextResponse.json({ error: "Archived contacts are not validated." }, { status: 409 });
  if (["accepted","valid","invalid"].includes(contact.validationStatus)) {
    return NextResponse.json({ error: `This contact already has a final validation status: ${contact.validationStatus}.` }, { status: 409 });
  }

  const [job] = await db.insert(validationJobs).values({ scope: `contact:${contact.id}`, totalRows: 1 }).returning({ id: validationJobs.id });
  await audit("validation.queued", session, "validation_job", job.id, { scope: "single_contact", contactId: contact.id, email: contact.email });
  return NextResponse.json({ ok: true, id: job.id, total: 1 });
}
