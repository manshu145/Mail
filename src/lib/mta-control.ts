const controlUrl = (process.env.MTA_CONTROL_URL || "http://mta:10026").replace(/\/$/, "");
const controlSecret = process.env.MTA_CONTROL_SECRET || process.env.BOUNCE_SECRET || "";

export type MtaDeleteResult =
  | { deleted: true; queueId: string }
  | { deleted: false; queueId: string; reason: "not_found" | "disabled" };

export async function deleteMtaQueueMessage(queueId: string): Promise<MtaDeleteResult> {
  const normalized = String(queueId || "").trim().toUpperCase();
  if (!/^[A-F0-9]{5,32}$/.test(normalized)) throw new Error("invalid_mta_queue_id");
  if (!controlSecret) return { deleted: false, queueId: normalized, reason: "disabled" };

  const response = await fetch(`${controlUrl}/queue/delete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-neximail-token": controlSecret,
    },
    body: JSON.stringify({ queueId: normalized }),
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await response.json().catch(() => ({})) as {
    deleted?: boolean;
    reason?: string;
    error?: string;
  };

  if (response.status === 404 && payload.reason === "not_found") {
    return { deleted: false, queueId: normalized, reason: "not_found" };
  }
  if (!response.ok) {
    throw new Error(payload.error || `mta_queue_delete_failed:${response.status}`);
  }
  if (payload.deleted !== true) {
    throw new Error("mta_queue_delete_not_confirmed");
  }
  return { deleted: true, queueId: normalized };
}
