import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { completeLogLines, parsePostfixLog } from "../../src/lib/postfix-log";
import { handlePostfixEvent } from "../../src/lib/postfix-events";
import { db, pool } from "../../src/db";
import { workerHeartbeats } from "../../src/db/operations-schema";
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
  await heartbeat({ state: "online", matched, pendingBatch: pending.rows.length, files: logs.length });
}

async function main() {
  while (!stopping) {
    const lock = await pool.connect();
    try {
      const result = await lock.query("select pg_try_advisory_lock(734201,2) as acquired");
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
