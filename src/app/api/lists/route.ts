import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { lists } from "@/db/schema";
import { segmentDefinitions } from "@/db/segment-schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const fields = new Set(["email_domain","validation_status","contact_status","custom_attribute"]);
const ops = new Set(["equals","not_equals"]);

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const b = await request.json().catch(() => null) as {
    name?: string;
    description?: string;
    type?: string;
    field?: string;
    operator?: string;
    value?: string;
    attributeKey?: string;
  } | null;

  const name = b?.name?.trim() || "";
  const dynamic = b?.type === "dynamic";
  const field = b?.field || "";
  const operator = b?.operator || "";
  const value = b?.value?.trim().toLowerCase() || "";
  const attributeKey = b?.attributeKey?.trim() || null;

  if (!name) return NextResponse.json({ error: "List name is required" }, { status: 400 });
  if (dynamic && (!fields.has(field) || !ops.has(operator) || !value || (field === "custom_attribute" && !attributeKey))) {
    return NextResponse.json({ error: "Dynamic segments require a valid field, operator and value. Custom attributes also require an attribute key." }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const rows = await tx.insert(lists).values({
        name,
        description: b?.description?.trim() || null,
        isDynamic: dynamic,
      }).onConflictDoNothing({ target: lists.name }).returning({ id: lists.id });
      if (!rows.length) throw new Error("duplicate");

      if (dynamic) {
        await tx.insert(segmentDefinitions).values({
          listId: rows[0].id,
          field: field as "email_domain"|"validation_status"|"contact_status"|"custom_attribute",
          attributeKey: field === "custom_attribute" ? attributeKey : null,
          operator: operator as "equals"|"not_equals",
          value,
        });
      }
      return rows[0];
    });

    await audit("list.created", session, "list", result.id, { name, dynamic });
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error && e.message === "duplicate" ? "List name already exists" : "Could not create list",
    }, { status: 409 });
  }
}
