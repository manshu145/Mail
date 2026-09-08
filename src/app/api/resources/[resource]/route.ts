import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, contacts, lists, sendingAccounts, suppressions, systemSettings, templates, validationJobs } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isValidEmail, normalizeEmail } from "@/lib/contact-utils";

function text(value: unknown) { return String(value ?? "").trim(); }

export async function POST(request: NextRequest, { params }: { params: Promise<{ resource: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database is not configured for this preview." }, { status: 503 });
  const { resource } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    if (resource === "lists") {
      const name = text(body.name);
      if (!name) return NextResponse.json({ error: "List name is required." }, { status: 400 });
      const rows = await db.insert(lists).values({ name, description: text(body.description) || null, isDynamic: text(body.type) === "dynamic" }).onConflictDoNothing({ target: lists.name }).returning({ id: lists.id });
      if (!rows.length) return NextResponse.json({ error: "A list with this name already exists." }, { status: 409 });
      return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
    }

    if (resource === "suppressions") {
      const email = text(body.email).toLowerCase();
      if (!isValidEmail(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      const allowed = ["unsubscribe", "hard_bounce", "manual", "invalid", "complaint", "policy"] as const;
      const reason = allowed.includes(text(body.reason) as typeof allowed[number]) ? text(body.reason) as typeof allowed[number] : "manual";
      const rows = await db.insert(suppressions).values({ email, normalizedEmail: normalizeEmail(email), reason, note: text(body.note) || null }).onConflictDoNothing({ target: suppressions.normalizedEmail }).returning({ id: suppressions.id });
      if (!rows.length) return NextResponse.json({ error: "Address is already suppressed." }, { status: 409 });
      return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
    }

    if (resource === "templates") {
      const name = text(body.name); const subject = text(body.subject); const htmlBody = text(body.htmlBody); const textBody = text(body.textBody);
      if (!name) return NextResponse.json({ error: "Template name is required." }, { status: 400 });
      const rows = await db.insert(templates).values({ name, subject: subject || null, htmlBody, textBody }).onConflictDoNothing({ target: templates.name }).returning({ id: templates.id });
      if (!rows.length) return NextResponse.json({ error: "A template with this name already exists." }, { status: 409 });
      return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
    }

    if (resource === "campaigns") {
      const name = text(body.name); const subject = text(body.subject);
      if (!name || !subject) return NextResponse.json({ error: "Campaign name and subject are required." }, { status: 400 });
      const rows = await db.insert(campaigns).values({ name, subject, preheader: text(body.preheader) || null, status: "draft" }).returning({ id: campaigns.id });
      return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
    }

    if (resource === "sending-accounts") {
      const name = text(body.name); const fromName = text(body.fromName); const fromEmail = text(body.fromEmail).toLowerCase();
      if (!name || !fromName || !isValidEmail(fromEmail)) return NextResponse.json({ error: "Name, sender name and a valid sender email are required." }, { status: 400 });
      const rows = await db.insert(sendingAccounts).values({ name, fromName, fromEmail, replyTo: text(body.replyTo) || null, transportType: "postfix" }).onConflictDoNothing({ target: sendingAccounts.name }).returning({ id: sendingAccounts.id });
      if (!rows.length) return NextResponse.json({ error: "A sending account with this name already exists." }, { status: 409 });
      return NextResponse.json({ ok: true, id: rows[0].id }, { status: 201 });
    }

    if (resource === "validation-jobs") {
      const [countRow] = await db.select({ value: sql<number>`count(*)::int` }).from(contacts).where(sql`lower(${contacts.normalizedEmail}) like '%@gmail.com' and ${contacts.status} = 'active'`);
      const total = countRow?.value ?? 0;
      const rows = await db.insert(validationJobs).values({ scope: "gmail", totalRows: total, status: "pending" }).returning({ id: validationJobs.id });
      return NextResponse.json({ ok: true, id: rows[0].id, total }, { status: 201 });
    }

    if (resource === "settings") {
      const key = text(body.key);
      if (!key) return NextResponse.json({ error: "Setting key is required." }, { status: 400 });
      const value = body.value ?? null;
      await db.insert(systemSettings).values({ key, value }).onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown resource." }, { status: 404 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not save this resource." }, { status: 500 });
  }
}
