import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { users } from "@/db/schema";

export type UserRole = "owner" | "admin" | "operator";
export type SessionPayload = { userId: string; email: string; name: string; role: UserRole };
const COOKIE_NAME = "neximail_session";
const PREVIEW_ONLY_SECRET = "neximail-vercel-preview-session-secret-v1";

function getSecret() {
  const value = process.env.AUTH_SECRET;
  if (value && value.length >= 32) return new TextEncoder().encode(value);

  const isVercelPreview = process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production";
  if (isVercelPreview && !databaseConfigured) {
    return new TextEncoder().encode(PREVIEW_ONLY_SECRET);
  }

  throw new Error("AUTH_SECRET must be at least 32 characters");
}

export async function createSession(payload:SessionPayload){ const token=await new SignJWT(payload).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("12h").sign(getSecret()); const store=await cookies(); store.set(COOKIE_NAME,token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*12}); }
export async function getSession():Promise<SessionPayload|null>{
 const store=await cookies(); const token=store.get(COOKIE_NAME)?.value; if(!token)return null;
 try{
  const {payload}=await jwtVerify(token,getSecret());
  const session={userId:String(payload.userId),email:String(payload.email),name:String(payload.name),role:payload.role as UserRole};
  if(!databaseConfigured) return session;
  if(!/^[0-9a-f-]{36}$/i.test(session.userId)) return null;
  const [user]=await db.select({id:users.id,email:users.email,name:users.name,role:users.role,status:users.status}).from(users).where(eq(users.id,session.userId)).limit(1);
  if(!user||user.status!=="active") return null;
  return {userId:user.id,email:user.email,name:user.name,role:user.role};
 }catch{return null}
}
export async function destroySession(){const store=await cookies();store.delete(COOKIE_NAME)}
export function canManageInfrastructure(role:UserRole){return role==="owner"}
export function canManageCampaigns(role:UserRole){return role==="owner"||role==="admin"||role==="operator"}
export function canManageUsers(role:UserRole){return role==="owner"}
