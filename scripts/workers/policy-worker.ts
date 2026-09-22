import { and, eq, sql } from "drizzle-orm";
import { db,pool } from "../../src/db";
import { contacts,messages,suppressions } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { hasConfirmedConsent } from "../../src/lib/consent-policy";
import { readDeliverySettings } from "../../src/lib/delivery-settings";
import { validationAllowsSend } from "../../src/lib/validation-policy";
import { decideAdaptiveDelivery } from "../../src/lib/adaptive-delivery";

const intervalMs=Math.max(1000,Number(process.env.POLICY_WORKER_INTERVAL_MS||"3000"));
async function heartbeat(meta:Record<string,unknown>={}){await db.insert(workerHeartbeats).values({workerName:"policy",metadata:meta}).onConflictDoUpdate({target:workerHeartbeats.workerName,set:{lastSeenAt:new Date(),metadata:meta}})}

type SafetyState={campaignId:string;released:number;releaseLimit:number;sample:number;bounced:number;bounceRate:number;state:string;canRelease:boolean;paused:boolean};
async function campaignSafety(campaignId:string,settings:Awaited<ReturnType<typeof readDeliverySettings>>):Promise<SafetyState>{
 const aggregate=await pool.query<{total:number;released:number;sample:number;bounced:number}>(`
  select count(*)::int total,
    count(*) filter(where status in ('ready_for_transport','sending','mta_accepted','deferred','delivered','bounced','failed'))::int released,
    count(*) filter(where status in ('delivered','bounced','failed'))::int sample,
    count(*) filter(where status='bounced')::int bounced
  from messages where campaign_id=$1
 `,[campaignId]);
 const values=aggregate.rows[0]||{total:0,released:0,sample:0,bounced:0};
 const total=Number(values.total||0),released=Number(values.released||0),sample=Number(values.sample||0),bounced=Number(values.bounced||0);
 const initial=Math.min(total,settings.canaryInitialBatch);
 await pool.query(`insert into campaign_delivery_safety(campaign_id,phase,release_limit,state) values($1,0,$2,$3) on conflict(campaign_id) do nothing`,[campaignId,initial,total<=initial?'open':'canary']);
 const current=await pool.query<{phase:number;release_limit:number;state:string}>(`select phase,release_limit,state from campaign_delivery_safety where campaign_id=$1 for update`,[campaignId]);
 const decision=decideAdaptiveDelivery({
  total,released,sample,bounced,
  phase:Number(current.rows[0]?.phase||0),
  releaseLimit:Number(current.rows[0]?.release_limit||0),
  config:{initialBatch:settings.canaryInitialBatch,secondBatch:settings.canarySecondBatch,thirdBatch:settings.canaryThirdBatch,bounceWarnRate:settings.canaryBounceWarnRate,bounceStopRate:settings.reputationBounceStopRate,reputationMinSample:settings.reputationMinSample},
 });
 const{phase,releaseLimit,state,bounceRate,paused,reason}=decision;
 if(paused){
  await pool.query(`update campaigns set status='paused',last_error='campaign.delivery_safety_bounce_stop',updated_at=now() where id=$1 and status='sending'`,[campaignId]);
 }
 await pool.query(`update campaign_delivery_safety set phase=$2,release_limit=$3,state=$4,sample_count=$5,bounced_count=$6,bounce_rate=$7,reason=$8,updated_at=now() where campaign_id=$1`,[
  campaignId,phase,releaseLimit,state,sample,bounced,bounceRate,reason,
 ]);
 return{campaignId,released,releaseLimit,sample,bounced,bounceRate,state,canRelease:!paused&&released<releaseLimit,paused};
}

async function runOnce(){
 const settings=await readDeliverySettings();

 // Re-evaluate safety for every actively-sending campaign on every policy cycle,
 // even when it has no queued rows left. Otherwise a campaign smaller than the
 // initial canary can release its whole audience and never observe later bounces.
 const activeCampaigns=await pool.query<{id:string}>(`
  select c.id::text
  from campaigns c
  where c.status='sending'
    and exists(select 1 from messages m where m.campaign_id=c.id)
  order by c.started_at nulls first,c.created_at
 `);
 const safetyCache=new Map<string,SafetyState>();
 let safetyPaused=0;
 for(const row of activeCampaigns.rows){
  const safety=await campaignSafety(row.id,settings);
  safetyCache.set(row.id,safety);
  if(safety.paused)safetyPaused++;
 }

 const activeResult=await db.execute(sql`select count(*)::int as count from messages where status in ('ready_for_transport','sending','mta_accepted','deferred')`);
 const active=Number((activeResult.rows[0] as Record<string,unknown>|undefined)?.count||0);
 const available=Math.max(0,settings.maxActiveQueued-active);
 if(!available){
  await heartbeat({state:"backpressure",active,maxActiveQueued:settings.maxActiveQueued,safetyCampaigns:activeCampaigns.rowCount||0,safetyPaused});
  return
 }
 const queuedResult=await pool.query<{id:string;campaign_id:string;contact_id:string}>(`
  select m.id::text,m.campaign_id::text,m.contact_id::text
  from messages m join campaigns c on c.id=m.campaign_id
  where m.status='queued' and c.status='sending'
  order by m.queued_at asc
  limit $1
 `,[Math.min(500,available)]);
 const queued=queuedResult.rows;
 let ready=0,cancelled=0,canaryHeld=0;
 for(const message of queued){
  let safety=safetyCache.get(message.campaign_id);
  if(!safety){safety=await campaignSafety(message.campaign_id,settings);safetyCache.set(message.campaign_id,safety)}
  if(safety.paused){continue}
  if(!safety.canRelease){canaryHeld++;continue}
  const [contact]=await db.select().from(contacts).where(eq(contacts.id,message.contact_id)).limit(1);
  if(!contact||contact.status!=="active"){await db.update(messages).set({status:"cancelled",lastError:"contact_not_active"}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));cancelled++;continue}
  if(!hasConfirmedConsent(contact)){await db.update(messages).set({status:"cancelled",lastError:"marketing_consent_missing"}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));cancelled++;continue}
  const [suppressed]=await db.select({id:suppressions.id,reason:suppressions.reason}).from(suppressions).where(eq(suppressions.normalizedEmail,contact.normalizedEmail)).limit(1);
  if(suppressed){await db.update(messages).set({status:"cancelled",lastError:`suppressed:${suppressed.reason}`}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));cancelled++;continue}
  if(!validationAllowsSend(contact.normalizedEmail, contact.validationStatus)){
   const reason=contact.validationStatus==="invalid"?"validation_invalid":"awaiting_gmail_validation";
   await db.update(messages).set({status:"cancelled",lastError:reason}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));cancelled++;continue
  }
  await db.update(messages).set({status:"ready_for_transport",lastError:null}).where(and(eq(messages.id,message.id),eq(messages.status,"queued")));ready++;safety.released++;safety.canRelease=safety.released<safety.releaseLimit
 }
 await heartbeat({state:"online",evaluated:queued.length,ready,cancelled,canaryHeld,safetyCampaigns:activeCampaigns.rowCount||0,safetyPaused,activeBefore:active,maxActiveQueued:settings.maxActiveQueued,canaryInitialBatch:settings.canaryInitialBatch,canarySecondBatch:settings.canarySecondBatch,canaryThirdBatch:settings.canaryThirdBatch,canaryBounceWarnRate:settings.canaryBounceWarnRate,bounceStopRate:settings.reputationBounceStopRate,source:"database_control_plane"})
}
async function main(){console.log("[policy-worker] started with database backpressure and adaptive delivery safety");while(true){
 const lock=await pool.connect();
 try{const result=await lock.query("select pg_try_advisory_lock(734201,3) as acquired");if(result.rows[0].acquired)await runOnce()}
 catch(e){console.error("[policy-worker]",e);await heartbeat({state:"error"}).catch(()=>{})}
 finally{await lock.query("select pg_advisory_unlock(734201,3)").catch(()=>{});lock.release()}
 await new Promise(r=>setTimeout(r,intervalMs))
}}
main().catch(console.error);process.on("SIGTERM",async()=>{await pool.end();process.exit(0)});
