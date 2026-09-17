import net from "node:net";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db";
import { makeBounceAddress } from "../src/lib/bounce-address";

const host = process.env.BOUNCE_RECEIVER_HOST || "bounce-receiver";
const port = Math.max(1, Number(process.env.BOUNCE_RECEIVER_PORT || "2526"));

async function smtpDsn(recipient: string) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setEncoding("utf8");
    socket.setTimeout(15000);
    let buffer = "";
    let stage = 0;
    const send = (line: string) => socket.write(`${line}\r\n`);
    const done = (err?: Error) => { socket.end(); socket.destroy(); err ? reject(err) : resolve(); };
    socket.on("error", done);
    socket.on("timeout", () => done(new Error("bounce receiver timeout")));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
      for (const line of lines) {
        const code = Number(line.slice(0, 3));
        if (!Number.isFinite(code)) continue;
        if (code >= 400) return done(new Error(`bounce receiver rejected: ${line}`));
        if (stage === 0 && code === 220) { stage = 1; send("EHLO neximail-smoke"); continue; }
        if (stage === 1 && code === 250 && !line.startsWith("250-")) { stage = 2; send("MAIL FROM:<> "); continue; }
        if (stage === 2 && code === 250) { stage = 3; send(`RCPT TO:<${recipient}>`); continue; }
        if (stage === 3 && code === 250) { stage = 4; send("DATA"); continue; }
        if (stage === 4 && code === 354) {
          stage = 5;
          socket.write([
            "From: MAILER-DAEMON@example.invalid",
            "To: bounce-test@example.invalid",
            "Subject: Delivery Status Notification (Failure)",
            "Content-Type: message/delivery-status",
            "",
            "Reporting-MTA: dns; mx.example.invalid",
            "Final-Recipient: rfc822; neximail-bounce-smoke@example.invalid",
            "Action: failed",
            "Status: 5.1.1",
            "Diagnostic-Code: smtp; 550 5.1.1 synthetic NexiMail bounce smoke test",
            "",
            ".",
            "",
          ].join("\r\n"));
          continue;
        }
        if (stage === 5 && code === 250) { stage = 6; send("QUIT"); continue; }
        if (stage === 6 && code === 221) return done();
      }
    });
  });
}

async function main() {
  if (!process.env.BOUNCE_DOMAIN || !process.env.BOUNCE_SECRET) throw new Error("BOUNCE_DOMAIN and BOUNCE_SECRET are required");
  const base = await pool.query<{ campaign_id: string; contact_id: string }>(`
    select c.id campaign_id, ct.id contact_id
    from campaigns c cross join contacts ct
    order by c.created_at desc, ct.created_at desc
    limit 1
  `);
  if (!base.rows[0]) throw new Error("Need at least one campaign and one contact before running bounce smoke test");

  const id = randomUUID();
  const email = `neximail-bounce-smoke-${Date.now()}@example.invalid`;
  const { campaign_id, contact_id } = base.rows[0];
  try {
    await pool.query(`insert into messages(id,campaign_id,contact_id,recipient_email,status,queued_at,accepted_at) values($1,$2,$3,$4,'mta_accepted',now(),now())`, [id, campaign_id, contact_id, email]);
    const bounceAddress = makeBounceAddress(id);
    console.log(`[smoke-bounce] sending synthetic hard DSN to ${bounceAddress}`);
    await smtpDsn(bounceAddress);
    await new Promise((r) => setTimeout(r, 1000));
    const message = await pool.query<{ status: string; bounced_at: Date | null }>(`select status,bounced_at from messages where id=$1`, [id]);
    const suppression = await pool.query<{ reason: string; source: string }>(`select reason,source from suppressions where normalized_email=lower($1)`, [email]);
    if (message.rows[0]?.status !== "bounced" || !message.rows[0]?.bounced_at) throw new Error(`Expected bounced message, got ${JSON.stringify(message.rows[0])}`);
    if (suppression.rows[0]?.reason !== "hard_bounce") throw new Error(`Expected hard_bounce suppression, got ${JSON.stringify(suppression.rows[0])}`);
    console.log(`[smoke-bounce] PASS status=${message.rows[0].status} suppression=${suppression.rows[0].reason} source=${suppression.rows[0].source}`);
  } finally {
    await pool.query(`delete from suppressions where normalized_email=lower($1)`, [email]).catch(() => {});
    await pool.query(`delete from messages where id=$1`, [id]).catch(() => {});
    await pool.end();
  }
}

main().catch(async (error) => { console.error("[smoke-bounce] FAIL", error); await pool.end().catch(() => {}); process.exit(1); });
