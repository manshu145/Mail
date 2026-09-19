import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, lists } from "@/db/schema";
import { segmentDefinitions } from "@/db/segment-schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/id";

const fields = new Set(["email_domain", "validation_status", "contact_status", "custom_attribute"]);
const ops = new Set(["equals", "not_equals"]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid audience id." }, { status: 400 });
  const [current] = await db.select().from(lists).where(eq(lists.id, id)).limit(1);
  if (!current) return NextResponse.json({ error: "Audience not found." }, { status: 404 });

  const body = await request.json().catch(() => null) as {
    name?: string;
    description?: string;
    field?: string;
    operator?: string;
    value?: string;
    attributeKey?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const name = body.name?.trim() || "";
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });

  try {
    await db.transaction(async (tx) => {
      const duplicate = await tx.select({ id: lists.id }).from(lists).where(sql`lower(${lists.name}) = lower(${name}) and ${lists.id} <> ${id}`).limit(1);
      if (duplicate.length) throw new Error("duplicate");

      await tx.update(lists).set({
        name,
        description: body.description?.trim() || null,
        updatedAt: new Date(),
      }).where(eq(lists.id, id));

      if (current.isDynamic) {
        const field = body.field || "";
        const operator = body.operator || "";
        const value = body.value?.trim().toLowerCase() || "";
        const attributeKey = body.attributeKey?.trim() || null;
        if (!fields.has(field) || !ops.has(operator) || !value || (field === "custom_attribute" && !attributeKey)) throw new Error("invalid_rule");
        await tx.insert(segmentDefinitions).values({
          listId: id,
          field: field as "email_domain" | "validation_status" | "contact_status" | "custom_attribute",
          attributeKey: field === "custom_attribute" ? attributeKey : null,
          operator: operator as "equals" | "not_equals",
          value,
        }).onConflictDoUpdate({
          target: segmentDefinitions.listId,
          set: {
            field: field as "email_domain" | "validation_status" | "contact_status" | "custom_attribute",
            attributeKey: field === "custom_attribute" ? attributeKey : null,
            operator: operator as "equals" | "not_equals",
            value,
            updatedAt: new Date(),
          },
        });
      }
    });

    await audit("list.updated", session, "list", id, { name, dynamic: current.isDynamic });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "duplicate") return NextResponse.json({ error: "Another list or segment already uses this name." }, { status: 409 });
    if (reason === "invalid_rule") return NextResponse.json({ error: "Dynamic segments require a valid field, operator and value." }, { status: 400 });
    console.error("[list-update]", error);
    return NextResponse.json({ error: "Could not update this audience." }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid audience id." }, { status: 400 });
  const [current] = await db.select().from(lists).where(eq(lists.id, id)).limit(1);
  if (!current) return NextResponse.json({ error: "Audience not found." }, { status: 404 });

  const [usage] = await db.select({ count: sql<number>`count(*)::int` }).from(campaigns).where(eq(campaigns.listId, id));
  if ((usage?.count || 0) > 0) {
    return NextResponse.json({
      error: `This audience is used by ${usage.count} campaign${usage.count === 1 ? "" : "s"}. Change those campaigns before deleting it.`,
      campaignCount: usage.count,
    }, { status: 409 });
  }

  await db.delete(lists).where(eq(lists.id, id));
  await audit("list.deleted", session, "list", id, { name: current.name, dynamic: current.isDynamic });
  return NextResponse.json({ ok: true });
}
