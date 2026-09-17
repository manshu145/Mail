import { and, eq, sql } from "drizzle-orm";
import { db,pool } from "../../src/db";
import { contacts,messages,suppressions } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { hasConfirmedConsent } from "../../src/lib/consent-policy";
import { readDeliverySettings } from "../../src/lib/delivery-settings";

const intervalMs=Math.max(1000,Number(process.env.POLICY_WORKER_INTERVAL_MS||"3000"));
async function heartbeat(meta:Record<string,unknown>={}){await db.insert(workerHeartbeats).values({workerName:"policy",metadata:meta}).onConflictDoUpdate({target:workerHeartbeats.workerName,set:{lastSeenAt:new Date(),metadata:meta}})}
async function runOnce(){
 const settings=await readDeliverySettings();
 const activeResult=await db.execute(sql`select count(*)::int as count from messages where status in ('ready_for_transport','sending','mta_accepted','deferred')`);
 const active=Number((activeResult.rows[0] as Record<string,unknown>|undefined)?.count||0);
 const available=Math.max(0,settings.maxActiveQueued-active);
 if(!available){await heartbeat({state:"backpressure",active,maxActiveQueued:settings.maxActiveQueued});return}
 const queued=await db.select().from(messages).where(eq(messages.status,"queued")).limit(Math.min(500,available));
 let ready=0,cancelled=0;
 for(const message of queued){
  const [contact]=await db.select().from(contacts).where(eq(contacts.id,message.contactId)).limit(1);
  if(!contact||contact.status!=="active"){await db.update(messages).set({status:"cancelled",lastError:"contact_not_active"}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));cancelled++;continue}
  if(!hasConfirmedConsent(contact)){await db.update(messages).set({status:"cancelled",lastError:"marketing_consent_missing"}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));cancelled++;continue}
  const [suppressed]=await db.select({id:suppressions.id,reason:suppressions.reason}).from(suppressions).where(eq(suppressions.normalizedEmail,contact.normalizedEmail)).limit(1);
  if(suppressed){await db.update(messages).set({status:"cancelled",lastError:`suppressed:${suppressed.reason}`}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));cancelled++;continue}
  if(contact.validationStatus==="invalid"){await db.update(messages).set({status:"cancelled",lastError:"validation_invalid"}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));cancelled++;continue}
  await db.update(messages).set({status:"ready_for_transport",lastError:null}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));ready++
 }
 await heartbeat({state:"online",evaluated:queued.length,ready,cancelled,activeBefore:active,maxActiveQueued:settings.maxActiveQueued,source:"database_control_plane"})
}
async function main(){console.log("[policy-worker] started with database backpressure control");while(true){try{await runOnce()}catch(e){console.error("[policy-worker]",e);await heartbeat({state:"error"}).catch(()=>{})}await new Promise(r=>setTimeout(r,intervalMs))}}
main().catch(console.error);process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
