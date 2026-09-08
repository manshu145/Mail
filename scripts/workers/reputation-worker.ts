import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { sendingAccounts } from "../../src/db/schema";
import { reputationSnapshots, workerHeartbeats } from "../../src/db/operations-schema";

const intervalMs=Math.max(60000,Number(process.env.REPUTATION_INTERVAL_MS||"300000"));
const bounceStop=Math.max(0,Number(process.env.REPUTATION_BOUNCE_STOP_RATE||"0.05"));
const complaintStop=Math.max(0,Number(process.env.REPUTATION_COMPLAINT_STOP_RATE||"0.003"));
const minSample=Math.max(1,Number(process.env.REPUTATION_MIN_SAMPLE||"100"));
async function heartbeat(meta:Record<string,unknown>={}){await db.insert(workerHeartbeats).values({workerName:"reputation",metadata:meta}).onConflictDoUpdate({target:workerHeartbeats.workerName,set:{lastSeenAt:new Date(),metadata:meta}})}
async function run(){
 const accounts=await db.select().from(sendingAccounts);
 for(const account of accounts){
  const r=await db.execute(sql`select count(*) filter (where m.status in ('mta_accepted','delivered','bounced','deferred','failed'))::int as sent, count(*) filter (where m.status='bounced')::int as bounced, count(*) filter (where m.status='deferred')::int as deferred, count(*) filter (where exists(select 1 from message_events e where e.message_id=m.id and e.type='complaint'))::int as complaints from messages m join campaigns c on c.id=m.campaign_id where c.sending_account_id=${account.id} and m.queued_at >= now()-interval '24 hours'`);
  const x=(r.rows[0]||{}) as Record<string,unknown>; const sent=Number(x.sent||0), bounced=Number(x.bounced||0), deferred=Number(x.deferred||0), complaints=Number(x.complaints||0); const bounceRate=sent?bounced/sent:0, complaintRate=sent?complaints/sent:0;
  await db.insert(reputationSnapshots).values({sendingAccountId:account.id,sent,bounced,deferred,complaints,bounceRate,complaintRate});
  if(account.status==="active" && sent>=minSample && (bounceRate>=bounceStop || complaintRate>=complaintStop)) await db.update(sendingAccounts).set({status:"paused",updatedAt:new Date()}).where(eq(sendingAccounts.id,account.id));
 }
 await heartbeat({accounts:accounts.length,bounceStop,complaintStop,minSample});
}
async function main(){while(true){try{await run()}catch(e){console.error("[reputation-worker]",e);await heartbeat({state:"error"}).catch(()=>{})}await new Promise(r=>setTimeout(r,intervalMs))}}
main().catch(console.error);process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
