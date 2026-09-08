import { NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { suppressions } from "@/db/schema";
import { normalizeEmail } from "@/lib/contact-utils";
import { verifyPublicToken } from "@/lib/public-tokens";

function page(token: string, message = "Confirm that you want to stop receiving marketing emails from this sender.") {
  const escaped = token.replace(/[^A-Za-z0-9._-]/g, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · NexiMail</title><style>body{font-family:Inter,Arial,sans-serif;background:#f6f5f2;color:#18181b;margin:0;padding:32px}.card{max-width:520px;margin:10vh auto;background:#fff;border:1px solid #e4e4e7;border-radius:22px;padding:28px;box-shadow:0 20px 60px rgba(24,24,27,.08)}h1{margin:0 0 12px;font-size:28px}p{color:#71717a;line-height:1.6}button{border:0;border-radius:12px;background:#27272a;color:#fff;padding:12px 18px;font-weight:800;cursor:pointer}</style></head><body><main class="card"><h1>Email preferences</h1><p>${message}</p><form method="post" action="/unsubscribe/${escaped}"><button type="submit">Unsubscribe</button></form></main></body></html>`;
}

async function decode(token: string) {
  const payload = await verifyPublicToken(token);
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) throw new Error("Invalid token");
  return email;
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try { await decode(token); return new Response(page(token), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
  catch { return new Response(page(token, "This unsubscribe link is invalid or has expired."), { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const email = await decode(token);
    if (!databaseConfigured) return new NextResponse("Unsubscribe service is temporarily unavailable.", { status: 503 });
    await db.insert(suppressions).values({ email, normalizedEmail: normalizeEmail(email), reason: "unsubscribe", source: "unsubscribe_link" }).onConflictDoUpdate({ target: suppressions.normalizedEmail, set: { reason: "unsubscribe", source: "unsubscribe_link" } });
    return new Response(page(token, "You have been unsubscribed. This address is now in the global suppression list."), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch { return new NextResponse("Invalid or expired unsubscribe link.", { status: 400 }); }
}
