import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type UserRole = "owner" | "admin" | "operator";

export type SessionPayload = {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
};

const COOKIE_NAME = "neximail_session";

function getSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: String(payload.userId),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as UserRole,
    };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export function canManageInfrastructure(role: UserRole) {
  return role === "owner";
}

export function canManageCampaigns(role: UserRole) {
  return role === "owner" || role === "admin" || role === "operator";
}
