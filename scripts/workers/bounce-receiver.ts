import net from "node:net";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { messageEvents, messages, suppressions } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";
import { parseBounceAddress } from "../../src/lib/bounce-address";
import { classifyBounce } from "../../src/lib/bounce-classification";
import { emitWebhookEvent } from "../../src/lib/webhooks";

const host = process.env.BOUNCE_RECEIVER_HOST || "0.0.0.0";
const port = Math.max(1, Number(process.env.BOUNCE_RECEIVER_PORT || "2526"));
const maxBytes = Math.max(65536, Number(process.env.BOUNCE_MAX_MESSAGE_BYTES || String(2 * 1024 * 1024)));

function extractAddress(input: string) {
  return input.match(/<([^>]+)>/)?.[1]?.trim() || input.trim().replace(/^TO:/i, "").trim();
}

function parseDsn(raw: string) {
  const action = raw.match(/^Action:\s*([^\r\n]+)/im)?.[1]?.trim().toLowerCase() || "unknown";
  const status = raw.match(/^Status:\s*([245](?:\.\d+){1,2})/im)?.[1] || raw.match(/\b([245]\.\d+\.\d+)\b/)?.[1] || null;
  const diagnostic = raw.match(/^Diagnostic-Code:\s*([^\r\n]+)/im)?.[1]?.trim() || raw.match(/^Final-Recipient:\s*([^\r\n]+)/im)?.[1]?.trim() || null;
  const delayed = action === "delayed" || Boolean(status?.startsWith("4."));
  return { action, status, diagnostic: diagnostic?.slice(0, 1000) || null, delayed };
}

async function heartbeat(meta: Record<string, unknown>) {
  await db.insert(workerHeartbeats).values({ workerName: "bounce-receiver", metadata: meta })
    .onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function processDsn(messageId: string, raw: string) {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) throw new Error("Unknown NexiMail message id");
  const dsn = parseDsn(raw);
  const classification = classifyBounce(dsn.status, dsn.diagnostic || raw.slice(-1000));
  const failed = dsn.action === "failed" || Boolean(dsn.status?.startsWith("5."));
  const payload = { action: dsn.action, status: dsn.status, diagnostic: dsn.diagnostic, source: "verp_dsn", bounceKind: classification.kind, suppressRecipient: classification.suppressRecipient };

  if (failed) {
    const wasAlreadyBounced = message.status === "bounced";
    if (!wasAlreadyBounced) {
      await db.update(messages).set({ status: "bounced", bouncedAt: new Date(), lastError: dsn.diagnostic || `DSN ${dsn.status || "failed"}` }).where(eq(messages.id, message.id));
    }
    // Preserve DSN evidence even when Postfix already observed the same terminal
    // outcome, but emit the external message.bounced webhook only once.
    await db.insert(messageEvents).values({ messageId: message.id, type: "dsn_bounced", payload: { ...payload, duplicateTerminalObservation: wasAlreadyBounced } });

    if (classification.suppressRecipient) {
      await db.insert(suppressions).values({
        email: message.recipientEmail,
        normalizedEmail: normalizeEmail(message.recipientEmail),
        reason: "hard_bounce",
        source: "verp_dsn",
        note: dsn.diagnostic || dsn.status || "Remote DSN recipient hard bounce",
      }).onConflictDoNothing({ target: suppressions.normalizedEmail });
    }

    if (!wasAlreadyBounced) {
      await emitWebhookEvent("message.bounced", { messageId: message.id, campaignId: message.campaignId, recipientEmail: message.recipientEmail, dsn: dsn.status, diagnostic: dsn.diagnostic, bounceKind: classification.kind, suppressRecipient: classification.suppressRecipient }).catch(() => {});
    }
    return "bounced";
  }

  await db.insert(messageEvents).values({ messageId: message.id, type: dsn.delayed ? "dsn_delayed" : "dsn_received", payload });
  if (dsn.delayed && !["delivered", "bounced", "failed", "cancelled"].includes(message.status)) {
    await db.update(messages).set({ lastError: dsn.diagnostic || `DSN ${dsn.status || "delayed"}` }).where(eq(messages.id, message.id));
  }
  return dsn.delayed ? "delayed" : "received";
}

function session(socket: net.Socket) {
  socket.setTimeout(30000);
  socket.setEncoding("utf8");
  socket.write("220 NexiMail bounce receiver ESMTP\r\n");
  let buffer = "";
  let dataMode = false;
  let dataLines: string[] = [];
  let dataBytes = 0;
  let messageId: string | null = null;
  let closed = false;

  const close = () => { if (!closed) { closed = true; socket.end(); } };
  const reply = (line: string) => socket.write(`${line}\r\n`);

  socket.on("timeout", close);
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    void (async () => {
      for (const rawLine of lines) {
        if (dataMode) {
          if (rawLine === ".") {
            dataMode = false;
            const raw = dataLines.join("\r\n");
            dataLines = [];
            dataBytes = 0;
            if (!messageId) { reply("550 5.1.1 Invalid bounce recipient"); continue; }
            try { await processDsn(messageId, raw); reply("250 2.0.0 DSN accepted"); }
            catch (error) { console.error("[bounce-receiver]", error); reply("451 4.3.0 Temporary processing error"); }
            continue;
          }
          const line = rawLine.startsWith("..") ? rawLine.slice(1) : rawLine;
          dataBytes += Buffer.byteLength(line) + 2;
          if (dataBytes > maxBytes) { dataMode = false; dataLines = []; reply("552 5.3.4 Message too large"); continue; }
          dataLines.push(line);
          continue;
        }

        if (/^(EHLO|HELO)\b/i.test(rawLine)) { reply("250-NexiMail bounce receiver"); reply(`250 SIZE ${maxBytes}`); continue; }
        if (/^MAIL FROM:/i.test(rawLine)) { messageId = null; reply("250 2.1.0 Ok"); continue; }
        if (/^RCPT TO:/i.test(rawLine)) {
          try {
            const parsed = parseBounceAddress(extractAddress(rawLine.slice(8)));
            if (!parsed) { reply("550 5.1.1 Invalid bounce recipient"); continue; }
            messageId = parsed.messageId;
            reply("250 2.1.5 Ok");
          } catch { reply("451 4.3.0 Bounce configuration unavailable"); }
          continue;
        }
        if (/^DATA$/i.test(rawLine)) {
          if (!messageId) { reply("503 5.5.1 Valid RCPT required"); continue; }
          dataMode = true; dataLines = []; dataBytes = 0; reply("354 End data with <CR><LF>.<CR><LF>"); continue;
        }
        if (/^RSET$/i.test(rawLine)) { messageId = null; dataMode = false; dataLines = []; reply("250 2.0.0 Reset"); continue; }
        if (/^NOOP$/i.test(rawLine)) { reply("250 2.0.0 Ok"); continue; }
        if (/^QUIT$/i.test(rawLine)) { reply("221 2.0.0 Bye"); close(); return; }
        reply("502 5.5.2 Command not implemented");
      }
    })().catch((error) => console.error("[bounce-receiver-session]", error));
  });
}

const server = net.createServer(session);
server.listen(port, host, async () => {
  console.log(`[bounce-receiver] listening on ${host}:${port}`);
  await heartbeat({ state: "online", host, port, maxBytes }).catch(() => {});
});

const heartbeatTimer = setInterval(() => heartbeat({ state: "online", host, port, maxBytes }).catch(() => {}), 30000);
async function shutdown() {
  clearInterval(heartbeatTimer);
  server.close();
  await heartbeat({ state: "stopped", host, port }).catch(() => {});
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
