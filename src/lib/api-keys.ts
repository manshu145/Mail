import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/integration-schema";

export const API_SCOPES = [
  "contacts:read",
  "contacts:write",
  "campaigns:read",
  "campaigns:write",
  "smtp:submit",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function newApiKey() {
  const raw = `nmx_${crypto.randomBytes(32).toString("base64url")}`;
  return {
    raw,
    prefix: raw.slice(0, 12),
    hash: crypto.createHash("sha256").update(raw).digest("hex"),
  };
}

export function normalizeScopes(input: unknown): ApiScope[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(API_SCOPES);
  return [...new Set(input.map(String).filter((scope) => allowed.has(scope)))] as ApiScope[];
}

export async function authenticateApiKey(request: Request, requiredScope: ApiScope) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const raw = match?.[1]?.trim();
  if (!raw?.startsWith("nmx_")) return null;

  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row || !row.scopes.includes(requiredScope)) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return row;
}
