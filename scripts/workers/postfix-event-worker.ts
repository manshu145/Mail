import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { completeLogLines, parsePostfixLog } from "../../src/lib/postfix-log";
import { handlePostfixEvent } from "../../src/lib/postfix-events";
import { db, pool } from "../../src/db";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { deleteMtaQueueMessage } from "../../src/lib/mta-control";
import { providerForDelivery, SENDER_COOLDOWN_KEY, UPSTREAM_COOLDOWN_KEY } from "../../src/lib/provider";
async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "postfix-events", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}
const logDirectory = process.env.POSTFIX_LOG_DIRECTORY || "/var/log/mta";
let stopping = false;

async function ingestFile(filename: string) {
  const file = await open(filename, "r");
  try {
    const info = await file.stat();
    const fileKey = `${info.dev}:${info.ino}`;
    for (let chunk = 0; chunk < 16; chunk++) {
      const saved = await pool.query("select byte_offset from postfix_log_checkpoints where file_key=$1", [fileKey]);
      let offset = Number(saved.rows[0]?.byte_offset || 0);
      if ((await file.stat()).size < offset) offset = 0;
      const bytes = Buffer.alloc(512 * 1024);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
      if (!bytesRead) return true;
      const batch = completeLogLines(bytes.subarray(0, bytesRead), offset);
      if (!batch.lines.length) {
        if (bytesRead === bytes.length) throw new Error("Postfix log line exceeds 512 KiB; checkpoint retained");
        return true;
      }
      // Do not advance the checkpoint until every relevant line is durable.
      await db.transaction(async tx => {
        for (const item of batch.lines) {
          const parsed = parsePostfixLog(item.line);
          if (!parsed) continue;
          await tx.execute(sql`insert into postfix_log_inbox(file_key,line_key,queue_id,message_id,outcome,raw_line)
            values(${fileKey},${item.key},${parsed.queueId},${parsed.messageId}::uuid,${parsed.outcome},${item.line})
            on conflict(file_key,line_key) do nothing`);
        }
        await tx.execute(sql`insert into postfix_log_checkpoints(file_key,byte_offset) values(${fileKey},${batch.nextOffset})
          on conflict(file_key) do update set byte_offset=excluded.byte_offset,updated_at=now()`);
      });
      if (bytesRead < bytes.length) return true;
    }
    return false;
  } finally { await file.close(); }
}


type ActiveCooldown = {
  sending_account_id: string;
  provider: string;
  next_probe_at: Date | null;
};
type AcceptedQueueMessage = {
  id: string;
  recipient_email: string;
  provider_message_id: string;
  last_error: string | null;
  sending_account_id: string;
  provider_probe: boolean;
  accepted_provider: string | null;
};

async function evacuateActiveCooldownQueues() {
  const cooldowns = await pool.query<ActiveCooldown>(`
    select sending_account_id,provider,next_probe_at
    from provider_cooldowns
    where active=true
  `);
  if (!cooldowns.rows.length) return { cooldowns: 0, candidates: 0, evacuated: 0, errors: 0 };

  const candidates = await pool.query<AcceptedQueueMessage>(`
    select
      m.id,
      m.recipient_email,
      m.provider_message_id,
      m.last_error,
      c.sending_account_id,
      coalesce((
        select (me.payload->>'providerProbe')::boolean
        from message_events me
        where me.message_id=m.id and me.type='mta_accepted'
        order by me.created_at desc
        limit 1
      ),false) as provider_probe,
      (
        select me.payload->>'provider'
        from message_events me
        where me.message_id=m.id and me.type='mta_accepted'
        order by me.created_at desc
        limit 1
      ) as accepted_provider
    from messages m
    join campaigns c on c.id=m.campaign_id
    where m.status='mta_accepted'
      and m.provider_message_id is not null
  `);

  let evacuated = 0;
  let errors = 0;
  for (const message of candidates.rows) {
    const provider = providerForDelivery(message.recipient_email, message.last_error);
    const cooldown = cooldowns.rows.find((row) =>
      row.sending_account_id === message.sending_account_id
      && (
        row.provider === UPSTREAM_COOLDOWN_KEY
        || row.provider === SENDER_COOLDOWN_KEY
        || row.provider === provider
        || row.provider === message.accepted_provider
      )
    );
    if (!cooldown) continue;

    // Leave the one scheduled probe in Postfix until it gets a real SMTP
    // outcome. If it is deferred, last_error becomes non-null and the next
    // reconciliation evacuates it back to the app queue.
    if (message.provider_probe && !message.last_error) continue;

    try {
      const deleted = await deleteMtaQueueMessage(message.provider_message_id);
      if (!deleted.deleted) continue;
      const retryAt = cooldown.next_probe_at || new Date(Date.now() + 15 * 60_000);
      const marker = cooldown.provider === UPSTREAM_COOLDOWN_KEY
        ? "upstream_cooldown"
        : cooldown.provider === SENDER_COOLDOWN_KEY
          ? "sender_cooldown"
        : `provider_cooldown:${cooldown.provider}`;
      const updated = await pool.query<{ id: string }>(`
        update messages
        set status='ready_for_transport',
            provider_message_id=null,
            accepted_at=null,
            next_attempt_at=$3,
            last_error=$4,
            attempt_count=greatest(attempt_count-1,0)
        where id=$1
          and status='mta_accepted'
          and provider_message_id=$2
        returning id
      `, [message.id, message.provider_message_id, retryAt, marker]);
      if (!updated.rowCount) continue;

      await pool.query(`
        insert into message_events(message_id,type,payload)
        values($1,'postfix_queue_evacuated',$2::jsonb)
      `, [message.id, JSON.stringify({
        queueId: message.provider_message_id,
        cooldownKey: cooldown.provider,
        provider,
        retryAt: retryAt.toISOString(),
      })]);
      evacuated++;
    } catch (error) {
      errors++;
      console.error("[postfix-event-worker] queue evacuation", message.provider_message_id, error);
    }
  }

  return {
    cooldowns: cooldowns.rows.length,
    candidates: candidates.rows.length,
    evacuated,
    errors,
  };
}

async function runOnce() {
  // All retained plain-text rotations are read, oldest first, including the initial deployment.
  const files = await readdir(logDirectory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const logs = await Promise.all(files.filter(name => /^mail\.log(?:\.\d+)?$/.test(name)).map(async name => {
    const filename = path.join(logDirectory, name);
    return { filename, modified: (await stat(filename)).mtimeMs };
  }));
  for (const log of logs.sort((a, b) => a.modified - b.modified)) {
    if (!await ingestFile(log.filename)) break;
  }
  const pending = await pool.query<{ id: string }>("select id from postfix_log_inbox where outcome is not null and processed_at is null and next_attempt_at<=now() order by id limit 500");
  let matched = 0;
  for (const item of pending.rows) {
    await db.transaction(async tx => {
      const result = await tx.execute(sql`select * from postfix_log_inbox where id=${item.id}::bigint and processed_at is null for update`);
      const row = result.rows[0];
      if (!row) return;
      const mapping = await tx.execute(sql`select message_id from postfix_log_inbox where queue_id=${row.queue_id} and message_id is not null and id<${item.id}::bigint order by id desc limit 1`);
      const messageId = mapping.rows[0]?.message_id as string | undefined;
      if (await handlePostfixEvent(tx, String(row.raw_line), messageId || null)) {
        await tx.execute(sql`update postfix_log_inbox set processed_at=now() where id=${item.id}::bigint`);
        matched++;
      } else {
        // Queue acceptance may not yet be committed; retain the event and retry.
        await tx.execute(sql`update postfix_log_inbox set next_attempt_at=now()+interval '30 seconds' where id=${item.id}::bigint`);
      }
    });
  }
  const queueControl = await evacuateActiveCooldownQueues();
  await heartbeat({ state: "online", matched, pendingBatch: pending.rows.length, files: logs.length, queueControl });
}

async function main() {
  while (!stopping) {
    const lock = await pool.connect();
    try {
      // Reconciliation has its own lock so campaign scheduling cannot starve
      // while Postfix logs are being ingested or cooldown queues evacuated.
      const result = await lock.query("select pg_try_advisory_lock(734201,4) as acquired");
      if (result.rows[0].acquired) await runOnce();
    } catch (error) {
      console.error("[postfix-event-worker]", error);
      await heartbeat({ state: "error" }).catch(() => {});
    } finally {
      await lock.query("select pg_advisory_unlock(734201,2)").catch(() => {});
      lock.release();
    }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
main().catch(console.error).finally(() => pool.end());
