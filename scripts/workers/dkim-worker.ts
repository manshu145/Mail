import fs from "node:fs/promises";
import path from "node:path";
import { db, pool } from "../../src/db";
import { sendingDomains, workerHeartbeats } from "../../src/db/operations-schema";
import { decryptDkimPrivateKey } from "../../src/lib/dkim-keys";

const intervalMs = Math.max(10000, Number(process.env.DKIM_SYNC_INTERVAL_MS || "60000"));
const root = process.env.DKIM_KEY_DIR || "/var/lib/neximail/dkim";

async function heartbeat(metadata: Record<string, unknown>) {
  await db.insert(workerHeartbeats).values({ workerName: "dkim", metadata }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata } });
}

async function atomicWrite(file: string, value: string, mode = 0o644) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, value, { encoding: "utf8", mode });
  await fs.rename(tmp, file);
  await fs.chmod(file, mode);
}

async function sync() {
  await fs.mkdir(root, { recursive: true });
  const domains = await db.select().from(sendingDomains);
  const keyTable: string[] = [];
  const signingTable: string[] = [];
  let written = 0;
  let skipped = 0;

  for (const row of domains) {
    if (!row.dkimPrivateKeyCiphertext || !row.dkimPublicKey || row.status === "disabled") { skipped++; continue; }
    try {
      const privateKey = decryptDkimPrivateKey(row.dkimPrivateKeyCiphertext);
      const selector = row.dkimSelector || "default";
      const domainDir = path.join(root, "keys", row.domain);
      const keyFile = path.join(domainDir, `${selector}.private`);
      await fs.mkdir(domainDir, { recursive: true });
      await atomicWrite(keyFile, privateKey, 0o640);
      const identity = `${selector}._domainkey.${row.domain}`;
      keyTable.push(`${identity} ${row.domain}:${selector}:${keyFile}`);
      signingTable.push(`*@${row.domain} ${identity}`);
      written++;
    } catch (error) {
      console.error(`[dkim-worker] ${row.domain}`, error);
      skipped++;
    }
  }

  await atomicWrite(path.join(root, "KeyTable"), `${keyTable.join("\n")}\n`);
  await atomicWrite(path.join(root, "SigningTable"), `${signingTable.join("\n")}\n`);
  await heartbeat({ state: "online", domains: domains.length, written, skipped });
}

async function main() {
  while (true) {
    try { await sync(); }
    catch (error) { console.error("[dkim-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
