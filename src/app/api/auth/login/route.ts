import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { verify } from "@node-rs/argon2";
import { db, databaseConfigured } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { isDemoAuthEnabled } from "@/lib/auth-policy";
import { audit } from "@/lib/audit";
import { getRedis, isRedisConfigured } from "@/lib/redis";

const PREVIEW_EMAIL = "admin@neximail.local";
const PREVIEW_PASSWORD = "NexiMail@2026!";

async function limited(request: NextRequest, email: string) {
  if (!isRedisConfigured()) return false;
  try {
    const redis = getRedis();
    if (redis.status === "wait") await redis.connect();
    const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
    const key = `auth:login:${ip}:${email}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 600);
    return n > 10;
  } catch {
    return false;
  }
}

function publicUrl(request: NextRequest, path: string) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return new URL(path, configured.endsWith("/") ? configured : `${configured}/`);

  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) return new URL(path, `${forwardedProto}://${forwardedHost}`);

  return new URL(path, request.url);
}

function loginRedirect(request: NextRequest, error: string) {
  return NextResponse.redirect(publicUrl(request, `/login?error=${encodeURIComponent(error)}`), 303);
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");

    if (!email || !password) return loginRedirect(request, "1");
    if (await limited(request, email)) {
      await audit("auth.login_rate_limited", null, "user", undefined, { email });
      return loginRedirect(request, "rate");
    }

    if (!databaseConfigured) {
      if (!isDemoAuthEnabled()) return loginRedirect(request, "config");
      if (email !== PREVIEW_EMAIL || password !== PREVIEW_PASSWORD) return loginRedirect(request, "1");
      await createSession({ userId: "preview-owner", email: PREVIEW_EMAIL, name: "NexiMail Owner", role: "owner" });
      return NextResponse.redirect(publicUrl(request, "/dashboard"), 303);
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || user.status !== "active") {
      await audit("auth.login_failed", null, "user", undefined, { email, reason: "missing_or_disabled" });
      return loginRedirect(request, "1");
    }

    const valid = await verify(user.passwordHash, password);
    if (!valid) {
      await audit("auth.login_failed", null, "user", user.id, { email, reason: "bad_password" });
      return loginRedirect(request, "1");
    }

    const session = { userId: user.id, email: user.email, name: user.name, role: user.role };
    await createSession(session);
    await audit("auth.login_success", session, "user", user.id);
    return NextResponse.redirect(publicUrl(request, "/dashboard"), 303);
  } catch (error) {
    console.error("[auth.login]", error);
    return loginRedirect(request, "config");
  }
}
