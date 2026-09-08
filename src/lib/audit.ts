import { db, databaseConfigured } from "@/db";
import { auditLogs } from "@/db/schema";
import type { SessionPayload } from "@/lib/auth";

export async function audit(action: string, session?: SessionPayload | null, entityType?: string, entityId?: string, metadata?: Record<string, unknown>) {
  if (!databaseConfigured) return;
  try {
    await db.insert(auditLogs).values({
      actorUserId: session?.userId && /^[0-9a-f-]{36}$/i.test(session.userId) ? session.userId : null,
      action,
      entityType: entityType || null,
      entityId: entityId || null,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (error) { console.error("[audit]", error); }
}
