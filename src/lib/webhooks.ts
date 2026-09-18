import { eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhookEndpoints, webhookEvents } from "@/db/integration-schema";

export async function emitWebhookEvent(eventType: string, payload: Record<string, unknown>, executor: Pick<typeof db, "insert" | "select"> = db) {
  const [event] = await executor
    .insert(webhookEvents)
    .values({ eventType, payload })
    .returning({ id: webhookEvents.id, createdAt: webhookEvents.createdAt });

  if (!event) return null;

  const endpoints = await executor
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.active, true));

  if (endpoints.length) {
    await executor.insert(webhookDeliveries).values(
      endpoints.map((endpoint) => ({
        webhookEventId: event.id,
        webhookEndpointId: endpoint.id,
        status: "pending" as const,
        nextAttemptAt: new Date(),
      })),
    );
  }

  return event;
}
