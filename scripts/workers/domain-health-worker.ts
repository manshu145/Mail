import { resolveTxt } from "node:dns/promises";
import { db, pool } from "../../src/db";
import { sendingDomains, workerHeartbeats } from "../../src/db/operations-schema";
import { eq } from "drizzle-orm";

const intervalMs = Math.max(60000, Number(process.env.DOMAIN_HEALTH_INTERVAL_MS || "300000"));
const selector = process.env.DKIM_SELECTOR || "default";
async function txt(name:string){ try { return (await resolveTxt(name)).map(x=>x.join("")).join("\n"); } catch { return ""; } }
async function heartbeat(meta:Record<string,unknown>={}){ await db.insert(workerHeartbeats).values({workerName:"domain-health",metadata:meta}).onConflictDoUpdate({target:workerHeartbeats.workerName,set:{lastSeenAt:new Date(),metadata:meta}}); }
async function run(){
  const domains=await db.select().from(sendingDomains);
  for(const row of domains){
    const [spf,dkim,dmarc]=await Promise.all([txt(row.domain),txt(`${selector}._domainkey.${row.domain}`),txt(`_dmarc.${row.domain}`)]);
    const spfOk=/v=spf1/i.test(spf); const dkimOk=/v=DKIM1|p=/i.test(dkim); const dmarcOk=/v=DMARC1/i.test(dmarc);
    await db.update(sendingDomains).set({spfOk,dkimOk,dmarcOk,status:spfOk&&dkimOk&&dmarcOk?"ready":"warning",lastCheckedAt:new Date(),updatedAt:new Date()}).where(eq(sendingDomains.id,row.id));
  }
  await heartbeat({checked:domains.length,selector});
}
async function main(){ while(true){ try{await run();}catch(e){console.error("[domain-health-worker]",e);await heartbeat({state:"error"}).catch(()=>{});} await new Promise(r=>setTimeout(r,intervalMs)); } }
main().catch(console.error); process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
