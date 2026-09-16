import { pool, db } from "../../src/db";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { decryptWebhookSecret, signWebhookBody } from "../../src/lib/webhook-secrets";
import { assertWebhookDestinationPublic } from "../../src/lib/webhook-url";

const intervalMs = Math.max(1000, Number(process.env.WEBHOOK_WORKER_INTERVAL_MS || "3000"));
const batchSize = Math.min(100, Math.max(1, Number(process.env.WEBHOOK_WORKER_BATCH_SIZE || "25")));
const maxAttempts = Math.max(1, Number(process.env.WEBHOOK_MAX_ATTEMPTS || "5"));
const requestTimeoutMs = Math.max(1000, Number(process.env.WEBHOOK_REQUEST_TIMEOUT_MS || "10000"));

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function retryDelaySeconds(attempt: number) { return Math.min(3600, Math.max(30, 30 * 2 ** Math.max(0, attempt - 1))); }

async function heartbeat(metadata: Record<string, unknown>) {
  await db.insert(workerHeartbeats).values({ workerName: "webhook", metadata }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata } });
}

type Claimed = {
  delivery_id: string;
  attempt_count: number;
  endpoint_url: string;
  secret_ciphertext: string;
  endpoint_active: boolean;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  event_created_at: Date;
};

async function recoverStale() {
  await pool.query(`update webhook_deliveries set status='pending', next_attempt_at=now(), updated_at=now(), response_text='recovered_stale_claim' where status='processing' and updated_at < now() - interval '10 minutes'`);
}

async function claim(): Promise<Claimed[]> {
  const result = await pool.query<Claimed>(
    `with picked as (
       select wd.id from webhook_deliveries wd
       join webhook_endpoints we on we.id=wd.webhook_endpoint_id
       where wd.status='pending' and we.active=true and (wd.next_attempt_at is null or wd.next_attempt_at<=now())
       order by wd.created_at asc for update of wd skip locked limit $1
     ), claimed as (
       update webhook_deliveries wd set status='processing', attempt_count=wd.attempt_count+1, updated_at=now()
       from picked where wd.id=picked.id returning wd.*
     )
     select c.id as delivery_id,c.attempt_count,we.url as endpoint_url,we.secret_ciphertext,we.active as endpoint_active,
            ev.id as event_id,ev.event_type,ev.payload,ev.created_at as event_created_at
     from claimed c join webhook_endpoints we on we.id=c.webhook_endpoint_id join webhook_events ev on ev.id=c.webhook_event_id`,
    [batchSize],
  );
  return result.rows;
}

async function retryOrFail(item: Claimed, responseCode: number | null, detail: string) {
  if (item.attempt_count >= maxAttempts) {
    await pool.query(`update webhook_deliveries set status='failed',response_code=$2,response_text=$3,next_attempt_at=null,updated_at=now() where id=$1 and status='processing'`, [item.delivery_id, responseCode, detail.slice(0, 1000)]);
    return "failed" as const;
  }
  const delay = retryDelaySeconds(item.attempt_count);
  await pool.query(`update webhook_deliveries set status='pending',response_code=$2,response_text=$3,next_attempt_at=now()+($4::int * interval '1 second'),updated_at=now() where id=$1 and status='processing'`, [item.delivery_id, responseCode, detail.slice(0, 1000), delay]);
  return "retry" as const;
}

async function deliver(item: Claimed) {
  if (!item.endpoint_active) {
    await pool.query(`update webhook_deliveries set status='failed',response_text='endpoint_disabled',next_attempt_at=null,updated_at=now() where id=$1`, [item.delivery_id]);
    return "failed" as const;
  }

  const body = JSON.stringify({ id: item.event_id, type: item.event_type, created_at: item.event_created_at, data: item.payload });
  let secret: string;
  try {
    await assertWebhookDestinationPublic(item.endpoint_url);
    secret = decryptWebhookSecret(item.secret_ciphertext);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "webhook_destination_rejected";
    await pool.query(`update webhook_deliveries set status='failed',response_text=$2,next_attempt_at=null,updated_at=now() where id=$1`, [item.delivery_id, detail.slice(0, 1000)]);
    return "failed" as const;
  }

  const signature = signWebhookBody(secret, body);
  try {
    const response = await fetch(item.endpoint_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "NexiMail-Webhook/1.0",
        "x-neximail-event": item.event_type,
        "x-neximail-delivery": item.delivery_id,
        "x-neximail-signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs),
      redirect: "manual",
    });
    const responseText = (await response.text().catch(() => "")).slice(0, 1000);
    if (response.ok) {
      await pool.query(`update webhook_deliveries set status='delivered',response_code=$2,response_text=$3,delivered_at=now(),next_attempt_at=null,updated_at=now() where id=$1 and status='processing'`, [item.delivery_id, response.status, responseText]);
      return "delivered" as const;
    }
    return retryOrFail(item, response.status, responseText || `HTTP ${response.status}`);
  } catch (error) {
    return retryOrFail(item, null, error instanceof Error ? error.message : "webhook_request_failed");
  }
}

async function runOnce() {
  const items = await claim();
  let delivered = 0, retried = 0, failed = 0;
  for (const item of items) {
    const result = await deliver(item);
    if (result === "delivered") delivered++;
    else if (result === "retry") retried++;
    else failed++;
  }
  await heartbeat({ state: "online", claimed: items.length, delivered, retried, failed });
}

async function main() {
  await recoverStale();
  while (true) {
    try { await runOnce(); }
    catch (error) { console.error("[webhook-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); }
    await sleep(intervalMs);
  }
}

main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
