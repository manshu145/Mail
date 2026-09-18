import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { contactLists, contacts, lists, messages } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

type Action = "add_to_list" | "remove_from_list" | "archive" | "restore" | "delete";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => null) as { contactIds?: string[]; action?: Action; listId?: string } | null;
  const ids = [...new Set((body?.contactIds || []).filter((x) => typeof x === "string" && x.length > 0))].slice(0, 500);
  const action = body?.action;
  if (!ids.length) return NextResponse.json({ error: "Select at least one contact." }, { status: 400 });
  if (!action || !["add_to_list","remove_from_list","archive","restore","delete"].includes(action)) {
    return NextResponse.json({ error: "Unknown bulk action." }, { status: 400 });
  }

  const existing = await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, ids));
  const existingIds = existing.map((x) => x.id);
  if (!existingIds.length) return NextResponse.json({ error: "No matching contacts found." }, { status: 404 });

  if (action === "add_to_list" || action === "remove_from_list") {
    const listId = String(body?.listId || "").trim();
    if (!listId) return NextResponse.json({ error: "Choose a list." }, { status: 400 });
    const [list] = await db.select({ id: lists.id, name: lists.name, isDynamic: lists.isDynamic }).from(lists).where(eq(lists.id, listId)).limit(1);
    if (!list) return NextResponse.json({ error: "List not found." }, { status: 404 });
    if (list.isDynamic) return NextResponse.json({ error: "Dynamic segments are rule-based and cannot accept manual members." }, { status: 409 });

    if (action === "add_to_list") {
      await db.insert(contactLists).values(existingIds.map((contactId) => ({ contactId, listId }))).onConflictDoNothing();
    } else {
      await db.delete(contactLists).where(and(eq(contactLists.listId, listId), inArray(contactLists.contactId, existingIds)));
    }
    await audit(`contacts.${action}`, session, "list", listId, { contactIds: existingIds, count: existingIds.length, listName: list.name });
    return NextResponse.json({ ok: true, count: existingIds.length, listName: list.name });
  }

  if (action === "archive" || action === "restore") {
    const status = action === "archive" ? "archived" : "active";
    await db.update(contacts).set({ status, updatedAt: new Date() }).where(inArray(contacts.id, existingIds));
    await audit(`contacts.${action}`, session, "contact", undefined, { contactIds: existingIds, count: existingIds.length });
    return NextResponse.json({ ok: true, count: existingIds.length });
  }

  const historyRows = await db.selectDistinct({ id: messages.contactId }).from(messages).where(inArray(messages.contactId, existingIds));
  const blocked = historyRows.map((row) => row.id);
  if (blocked.length) {
    return NextResponse.json({
      error: `${blocked.length} selected contact${blocked.length === 1 ? " has" : "s have"} campaign/message history. Archive instead to preserve reporting.`,
      blockedIds: blocked,
    }, { status: 409 });
  }

  await db.delete(contacts).where(inArray(contacts.id, existingIds));
  await audit("contacts.deleted", session, "contact", undefined, { contactIds: existingIds, count: existingIds.length });
  return NextResponse.json({ ok: true, count: existingIds.length });
}
