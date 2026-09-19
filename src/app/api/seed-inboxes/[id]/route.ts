import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { seedInboxes } from "@/db/operations-schema";
import { audit } from "@/lib/audit";
import { canManageInfrastructure, getSession } from "@/lib/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid seed inbox id." }, { status: 400 });

  const body = await request.json().catch(() => null) as { active?: boolean } | null;
  if (!body || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "Active status is required." }, { status: 400 });
  }

  const rows = await db
    .update(seedInboxes)
    .set({ active: body.active })
    .where(eq(seedInboxes.id, id))
    .returning({ id: seedInboxes.id, email: seedInboxes.email });

  if (!rows.length) return NextResponse.json({ error: "Seed inbox not found." }, { status: 404 });

  await audit(body.active ? "seed_inbox.enabled" : "seed_inbox.disabled", session, "seed_inbox", id, {
    email: rows[0].email,
  });

  return NextResponse.json({ ok: true, active: body.active });
}
