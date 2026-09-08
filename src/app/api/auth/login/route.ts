import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verify } from "@node-rs/argon2";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");

  if (!email || !password) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.status !== "active") {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const valid = await verify(user.passwordHash, password);
  if (!valid) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  await createSession({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  return NextResponse.redirect(new URL("/dashboard", request.url), 303);
}
