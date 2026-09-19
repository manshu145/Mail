import { resolve4, resolveTxt } from "node:dns/promises";
import { db, pool } from "../../src/db";
import { sendingDomains, workerHeartbeats } from "../../src/db/operations-schema";
import { eq } from "drizzle-orm";

const intervalMs = Math.max(60000, Number(process.env.DOMAIN_HEALTH_INTERVAL_MS || "300000"));
const mtaHostname = String(process.env.MTA_HOSTNAME || "").trim().toLowerCase();
const configuredPublicIp = String(process.env.MTA_PUBLIC_IP || "").trim();

async function txt(name:string){ try { return (await resolveTxt(name)).map(x=>x.join("")).join("\n"); } catch { return ""; } }
async function ipv4(name:string){ try { return await resolve4(name); } catch { return []; } }
async function heartbeat(meta:Record<string,unknown>={}){ await db.insert(workerHeartbeats).values({workerName:"domain-health",metadata:meta}).onConflictDoUpdate({target:workerHeartbeats.workerName,set:{lastSeenAt:new Date(),metadata:meta}}); }

function normalizeDkim(value:string){return value.replace(/\s+/g,"").replace(/"/g,"").toLowerCase()}
function spfAuthorizesIp(record:string, ip:string){
  const escaped=ip.replaceAll(".","\\.");
  return new RegExp(`(?:^|\\s)\\+?ip4:${escaped}(?:/32)?(?=\\s|$)`,"i").test(record.replace(/["\']/g," "));
}

async function outboundIpv4s(){
  if(configuredPublicIp) return [configuredPublicIp];
  if(!mtaHostname) return [];
  return ipv4(mtaHostname);
}

async function run(){
  const domains=await db.select().from(sendingDomains);
  const outboundIps=await outboundIpv4s();
  for(const row of domains){
    const selector=row.dkimSelector||"default";
    const [spf,dkim,dmarc]=await Promise.all([txt(row.domain),txt(`${selector}._domainkey.${row.domain}`),txt(`_dmarc.${row.domain}`)]);
    const spfRecordPresent=/v=spf1/i.test(spf);
    const spfIpAuthorized=outboundIps.length>0&&outboundIps.some(ip=>spfAuthorizesIp(spf,ip));
    const spfOk=spfRecordPresent&&spfIpAuthorized;
    const expected=row.dkimPublicKey?normalizeDkim(`p=${row.dkimPublicKey}`):null;
    const actual=normalizeDkim(dkim);
    const dkimOk=Boolean(expected&&/v=dkim1/i.test(dkim)&&actual.includes(expected));
    const dmarcOk=/v=dmarc1/i.test(dmarc);
    const nextStatus=row.status==="disabled"?"disabled":spfOk&&dkimOk&&dmarcOk?"ready":"warning";
    await db.update(sendingDomains).set({spfOk,dkimOk,dmarcOk,status:nextStatus,lastCheckedAt:new Date(),updatedAt:new Date()}).where(eq(sendingDomains.id,row.id));
  }
  await heartbeat({state:"online",checked:domains.length,spfIdentityReady:outboundIps.length>0});
}
async function main(){ while(true){ try{await run();}catch(e){console.error("[domain-health-worker]",e);await heartbeat({state:"error"}).catch(()=>{});} await new Promise(r=>setTimeout(r,intervalMs)); } }
main().catch(console.error); process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
