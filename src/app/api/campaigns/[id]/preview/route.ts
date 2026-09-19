import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, lists, templates } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { preflightAudience } from "@/lib/audience-preflight";
import { samplePersonalization } from "@/lib/personalization";
import { isUuid } from "@/lib/id";

function value(input: unknown) {
  const v = String(input ?? "").trim();
  return v || null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid resource id." }, { status: 400 });
  const body = await request.json().catch(() => null) as { listId?: string; templateId?: string } | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const listId = value(body.listId);
  const templateId = value(body.templateId);
  if (!listId || !templateId) return NextResponse.json({ error: "Choose an audience and template first." }, { status: 400 });

  const [[list], [template]] = await Promise.all([
    db.select().from(lists).where(eq(lists.id, listId)).limit(1),
    db.select().from(templates).where(eq(templates.id, templateId)).limit(1),
  ]);
  if (!list) return NextResponse.json({ error: "Audience not found." }, { status: 404 });
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });

  const audience = await preflightAudience(list);
  const recipient = "alex.customer@example.com";
  const html = samplePersonalization(template.htmlBody || "", recipient).replaceAll("{{unsubscribe_url}}", "#unsubscribe");
  const text = samplePersonalization(template.textBody || "", recipient).replaceAll("{{unsubscribe_url}}", "https://example.com/unsubscribe");

  return NextResponse.json({
    ok: true,
    audience: {
      rawCount: audience.rawCount,
      eligibleCount: audience.eligibleCount,
      suppressedCount: audience.suppressedCount,
      invalidCount: audience.invalidCount,
      validCount: audience.validCount,
      pendingCount: audience.pendingCount,
      unknownCount: audience.unknownCount,
      awaitingValidationCount: audience.awaitingValidationCount,
    },
    template: {
      name: template.name,
      subject: template.subject,
      html,
      text,
    },
  });
}
