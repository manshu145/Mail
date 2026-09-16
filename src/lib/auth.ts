import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { users } from "@/db/schema";
import { getAuthSecret, isDemoAuthEnabled } from "@/lib/auth-policy";

export type UserRole = "owner" | "admin" | "operator";
export type SessionPayload = { userId: string; email: string; name: string; role: UserRole };
const COOKIE_NAME = "neximail_session";
export async function createSession(payload:SessionPayload){ const token=await new SignJWT(payload).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("12h").sign(getAuthSecret()); const store=await cookies(); store.set(COOKIE_NAME,token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*12}); }
export async function getSession():Promise<SessionPayload|null>{
 const store=await cookies(); const token=store.get(COOKIE_NAME)?.value; if(!token)return null;
 try{
  const {payload}=await jwtVerify(token,getAuthSecret(),{algorithms:["HS256"]});
  if (typeof payload.userId !== "string" || typeof payload.email !== "string" ||
      typeof payload.name !== "string" || !["owner", "admin", "operator"].includes(String(payload.role))) return null;
  const session={userId:payload.userId,email:payload.email,name:payload.name,role:payload.role as UserRole};
  if(!databaseConfigured) return isDemoAuthEnabled() && session.userId === "preview-owner" && session.role === "owner" ? session : null;
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
