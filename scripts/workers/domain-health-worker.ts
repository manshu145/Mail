import { resolveTxt } from "node:dns/promises";
import { db, pool } from "../../src/db";
import { sendingDomains, workerHeartbeats } from "../../src/db/operations-schema";
import { eq } from "drizzle-orm";

const intervalMs = Math.max(60000, Number(process.env.DOMAIN_HEALTH_INTERVAL_MS || "300000"));
async function txt(name:string){ try { return (await resolveTxt(name)).map(x=>x.join("")).join("\n"); } catch { return ""; } }
async function heartbeat(meta:Record<string,unknown>={}){ await db.insert(workerHeartbeats).values({workerName:"domain-health",metadata:meta}).onConflictDoUpdate({target:workerHeartbeats.workerName,set:{lastSeenAt:new Date(),metadata:meta}}); }

function normalizeDkim(value:string){return value.replace(/\s+/g,"").replace(/"/g,"").toLowerCase()}

async function run(){
  const domains=await db.select().from(sendingDomains);
  for(const row of domains){
    const selector=row.dkimSelector||"default";
    const [spf,dkim,dmarc]=await Promise.all([txt(row.domain),txt(`${selector}._domainkey.${row.domain}`),txt(`_dmarc.${row.domain}`)]);
    const spfOk=/v=spf1/i.test(spf);
    const expected=row.dkimPublicKey?normalizeDkim(`p=${row.dkimPublicKey}`):null;
    const actual=normalizeDkim(dkim);
    const dkimOk=Boolean(expected&&/v=dkim1/i.test(dkim)&&actual.includes(expected));
    const dmarcOk=/v=dmarc1/i.test(dmarc);
    const nextStatus=row.status==="disabled"?"disabled":spfOk&&dkimOk&&dmarcOk?"ready":"warning";
    await db.update(sendingDomains).set({spfOk,dkimOk,dmarcOk,status:nextStatus,lastCheckedAt:new Date(),updatedAt:new Date()}).where(eq(sendingDomains.id,row.id));
  }
  await heartbeat({state:"online",checked:domains.length});
}
async function main(){ while(true){ try{await run();}catch(e){console.error("[domain-health-worker]",e);await heartbeat({state:"error"}).catch(()=>{});} await new Promise(r=>setTimeout(r,intervalMs)); } }
main().catch(console.error); process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
