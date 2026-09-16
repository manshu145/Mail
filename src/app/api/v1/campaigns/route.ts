import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { campaigns } from "@/db/schema";
import { authenticateApiKey } from "@/lib/api-keys";

export async function GET(request: NextRequest) {
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const key = await authenticateApiKey(request, "campaigns:read");
  if (!key) return NextResponse.json({ error: "Invalid API key or scope" }, { status: 401 });
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "50")));
  const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(limit);
  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const key = await authenticateApiKey(request, "campaigns:write");
  if (!key) return NextResponse.json({ error: "Invalid API key or scope" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { name?: string; subject?: string; preheader?: string } | null;
  const name = String(body?.name || "").trim().slice(0, 200);
  const subject = String(body?.subject || "").trim().slice(0, 500);
  if (!name || !subject) return NextResponse.json({ error: "name and subject are required" }, { status: 400 });
  const [row] = await db.insert(campaigns).values({ name, subject, preheader: String(body?.preheader || "").trim() || null, status: "draft" }).returning();
  return NextResponse.json({ data: row }, { status: 201 });
}
