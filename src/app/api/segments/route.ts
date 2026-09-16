import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { lists } from "@/db/schema";
import { segmentDefinitions } from "@/db/segment-schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

const fields = ["email_domain", "validation_status", "contact_status"] as const;
const operators = ["equals", "not_equals"] as const;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { name?: string; description?: string; field?: string; operator?: string; value?: string } | null;
  const name = String(body?.name || "").trim().slice(0, 120);
  const description = String(body?.description || "").trim().slice(0, 500) || null;
  const field = fields.includes(body?.field as typeof fields[number]) ? body!.field as typeof fields[number] : null;
  const operator = operators.includes(body?.operator as typeof operators[number]) ? body!.operator as typeof operators[number] : null;
  let value = String(body?.value || "").trim().toLowerCase();
  if (!name || !field || !operator || !value) return NextResponse.json({ error: "Name, field, operator and value are required." }, { status: 400 });

  if (field === "email_domain") value = value.replace(/^@/, "");
  if (field === "validation_status" && !["pending", "valid", "invalid", "unknown", "error"].includes(value)) return NextResponse.json({ error: "Invalid validation status." }, { status: 400 });
  if (field === "contact_status" && !["active", "archived"].includes(value)) return NextResponse.json({ error: "Invalid contact status." }, { status: 400 });

  try {
    const result = await db.transaction(async (tx) => {
      const [list] = await tx.insert(lists).values({ name, description, isDynamic: true }).returning({ id: lists.id });
      await tx.insert(segmentDefinitions).values({ listId: list.id, field, operator, value });
      return list;
    });
    await audit("segment.created", session, "segment", result.id, { name, field, operator, value });
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (error) {
    console.error("[segment.create]", error);
    return NextResponse.json({ error: "Could not create segment. The name may already exist." }, { status: 409 });
  }
}
