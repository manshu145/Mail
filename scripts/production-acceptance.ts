import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { campaigns, contactLists, contacts, importJobs, lists, messageEvents, messages, sendingAccounts, suppressions, templates, users } from "../src/db/schema";
import { importUploads } from "../src/db/import-schema";
import { seedInboxes, sendingDomains, workerHeartbeats } from "../src/db/operations-schema";
import { signPublicToken } from "../src/lib/public-tokens";

const baseUrl = "http://127.0.0.1:3000";
const stamp = Date.now();
const results: Array<{check:string; status:"PASS"|"WARN"|"FAIL"; detail:string}> = [];
const created: { importJobId?: string; contactId?: string; email?: string; listId?: string; templateId?: string; campaignId?: string; messageId?: string } = {};

function record(check:string,status:"PASS"|"WARN"|"FAIL",detail:string){
  results.push({check,status,detail});
  console.log(`[${status}] ${check}: ${detail}`);
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function waitFor<T>(label:string, timeoutMs:number, fn:()=>Promise<T|null>):Promise<T|null>{
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){ const value=await fn(); if(value) return value; await sleep(2000); }
  record(label,"WARN",`timed out after ${Math.round(timeoutMs/1000)}s`);
  return null;
}

async function sessionCookie(user:{id:string;email:string;name:string;role:"owner"|"admin"|"operator"}){
  const secret=process.env.AUTH_SECRET;
  if(!secret || secret.length<32) throw new Error("AUTH_SECRET is missing or too short");
  const token=await new SignJWT({userId:user.id,email:user.email,name:user.name,role:user.role})
    .setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("12h")
    .sign(new TextEncoder().encode(secret));
  return `neximail_session=${token}`;
}

async function runBounceSmoke(){
  return new Promise<number>((resolve)=>{
    const child=spawn("npm",["run","smoke:bounce"],{stdio:"inherit",env:process.env});
    child.on("close",code=>resolve(code ?? 1));
  });
}

async function main(){
  await pool.query("select 1");
  record("PostgreSQL","PASS","select 1 succeeded");

  const owners=await db.select({id:users.id,email:users.email,name:users.name,role:users.role,status:users.status}).from(users).where(eq(users.status,"active"));
  const owner=owners.find(u=>u.role==="owner");
  if(!owner) throw new Error("No active owner user exists");
  record("Owner account","PASS",`active owner present (${owner.email})`);

  const heartbeats=await db.select().from(workerHeartbeats);
  const expected=["import","campaign","policy","transport","bounce-receiver","event","postfix-events","dkim","validation","domain-health","reputation","webhook"];
  const hbMap=new Map(heartbeats.map(h=>[h.workerName,h]));
  const missing:string[]=[]; const stale:string[]=[];
  for(const name of expected){
    const hb=hbMap.get(name);
    if(!hb) missing.push(name);
    else if(Date.now()-hb.lastSeenAt.getTime()>600000) stale.push(`${name}(${Math.round((Date.now()-hb.lastSeenAt.getTime())/1000)}s)`);
  }
  if(!missing.length && !stale.length) record("Worker heartbeats","PASS",`${expected.length}/${expected.length} fresh`);
  else record("Worker heartbeats","FAIL",`missing=[${missing.join(",")}] stale=[${stale.join(",")}]`);

  const integrity=await pool.query(`
    select
      count(*) filter(where status='delivered' and delivered_at is null)::int delivered_missing_time,
      count(*) filter(where status='bounced' and bounced_at is null)::int bounced_missing_time,
      count(*) filter(where delivered_at is not null and bounced_at is not null)::int conflicting_terminal
    from messages`);
  const ir=integrity.rows[0];
  const bad=Number(ir.delivered_missing_time||0)+Number(ir.bounced_missing_time||0)+Number(ir.conflicting_terminal||0);
  record("Message integrity",bad?"FAIL":"PASS",JSON.stringify(ir));

  const staleJobs=await pool.query(`
    select
      (select count(*) from import_jobs where status='processing' and created_at < now()-interval '30 minutes')::int stale_imports,
      (select count(*) from validation_jobs where status='processing' and created_at < now()-interval '2 hours')::int stale_validations,
      (select count(*) from campaigns where status='sending' and updated_at < now()-interval '30 minutes')::int stale_campaigns`);
  const sj=staleJobs.rows[0];
  const staleCount=Object.values(sj).reduce((a,v)=>a+Number(v||0),0);
  record("Stuck work",staleCount?"FAIL":"PASS",JSON.stringify(sj));

  const domains=await db.select().from(sendingDomains);
  if(!domains.length) record("Sending-domain auth","WARN","no sending domain configured");
  else {
    const badDomains=domains.filter(d=>d.status!=="ready" || !d.spfOk || !d.dkimOk || !d.dmarcOk);
    record("Sending-domain auth",badDomains.length?"WARN":"PASS",
      domains.map(d=>`${d.domain}:status=${d.status},spf=${d.spfOk},dkim=${d.dkimOk},dmarc=${d.dmarcOk}`).join(" | "));
  }

  const cookie=await sessionCookie(owner);
  const dashboard=await fetch(`${baseUrl}/dashboard`,{headers:{cookie},redirect:"manual"});
  record("Owner session",dashboard.status===200?"PASS":"FAIL",`GET /dashboard -> ${dashboard.status}`);
  const ownerRbac=await fetch(`${baseUrl}/api/users`,{method:"POST",headers:{cookie,"content-type":"application/json"},body:"{}",redirect:"manual"});
  record("Owner RBAC",ownerRbac.status===400?"PASS":"FAIL",`invalid user create reached validation -> ${ownerRbac.status}`);

  const nonOwner=owners.find(u=>u.role!=="owner");
  if(nonOwner){
    const nonOwnerCookie=await sessionCookie(nonOwner);
    const denied=await fetch(`${baseUrl}/api/users`,{method:"POST",headers:{cookie:nonOwnerCookie,"content-type":"application/json"},body:"{}",redirect:"manual"});
    record("Non-owner RBAC",denied.status===403?"PASS":"FAIL",`${nonOwner.role} user create -> ${denied.status}`);
  } else record("Non-owner RBAC","WARN","no active admin/operator account exists to exercise denial path");

  // Real import-worker acceptance test. Prefer a configured Gmail seed alias so
  // the same test can exercise the Gmail validation worker without inventing a mailbox.
  const [seed]=await db.select().from(seedInboxes).where(eq(seedInboxes.active,true)).limit(1);
  let testEmail=`neximail-acceptance-${stamp}@example.invalid`;
  let canValidate=false;
  if(seed && /@(gmail|googlemail)\.com$/i.test(seed.email)){
    const [local,domain]=seed.email.split("@");
    testEmail=`${local}+neximail-acceptance-${stamp}@${domain}`;
    canValidate=true;
  }
  created.email=testEmail;
  const csv=`email,first_name\n${testEmail},Acceptance\n`;
  const [job]=await db.insert(importJobs).values({filename:`acceptance-${stamp}.csv`,createdBy:owner.id}).returning({id:importJobs.id});
  created.importJobId=job.id;
  await db.insert(importUploads).values({
    jobId:job.id,content:csv,headers:["email","first_name"],mapping:{email:"email",first_name:"first_name"},
    options:{consentSource:"production_acceptance",consentStatus:"confirmed",defaultSource:"production_acceptance",queueValidation:canValidate},
    sizeBytes:Buffer.byteLength(csv)
  });
  const imported=await waitFor("Import worker",60000,async()=>{
    const j=await pool.query("select status,imported_rows,invalid_rows,error_message,validation_job_id from import_jobs where id=$1",[job.id]);
    if(j.rows[0]?.status==="failed") throw new Error(`Import failed: ${j.rows[0].error_message}`);
    if(j.rows[0]?.status!=="completed") return null;
    const c=await pool.query("select id,email,consent_status,consent_source,validation_status from contacts where normalized_email=lower($1)",[testEmail]);
    if(!c.rows[0]) { record("CSV import","FAIL","import job completed but contact was not created"); return {job:j.rows[0],contact:null}; }
    created.contactId=c.rows[0].id;
    return {job:j.rows[0],contact:c.rows[0]};
  });
  if(imported?.contact) record("CSV import","PASS",`contact created with consent=${imported.contact.consent_status}, validation=${imported.contact.validation_status}`);

  if(canValidate && imported?.contact){
    const validation=await waitFor("Gmail validation",150000,async()=>{
      const j=await pool.query("select validation_job_id from import_jobs where id=$1",[job.id]);
      const id=j.rows[0]?.validation_job_id; if(!id) return null;
      const v=await pool.query("select status,total_rows,processed_rows from validation_jobs where id=$1",[id]);
      if(v.rows[0]?.status!=="completed") return null;
      const r=await pool.query("select status,detail from validation_results where job_id=$1 order by created_at desc limit 1",[id]);
      return {job:v.rows[0],result:r.rows[0]||null};
    });
    if(validation) record("Gmail validation","PASS",JSON.stringify(validation));
  } else record("Gmail validation","WARN","no active Gmail seed inbox configured; validation probe skipped rather than inventing a mailbox");

  const [account]=await db.select().from(sendingAccounts).where(eq(sendingAccounts.status,"active")).limit(1);
  if(canValidate && seed && account && created.contactId){
    const [list]=await db.insert(lists).values({name:`__acceptance_${stamp}`,description:"Automated production acceptance test"}).returning({id:lists.id});
    created.listId=list.id;
    await db.insert(contactLists).values({contactId:created.contactId,listId:list.id});
    const [template]=await db.insert(templates).values({
      name:`__acceptance_${stamp}`,subject:"NexiMail production acceptance",
      htmlBody:'<p>Acceptance test.</p><p><a href="https://example.com/">Tracking link</a></p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
      textBody:"Acceptance test. https://example.com/ Unsubscribe: {{unsubscribe_url}}"
    }).returning({id:templates.id});
    created.templateId=template.id;
    const [campaign]=await db.insert(campaigns).values({
      name:`__acceptance_${stamp}`,subject:"NexiMail production acceptance",templateId:template.id,listId:list.id,
      sendingAccountId:account.id,status:"queued",trackOpens:true,trackClicks:true
    }).returning({id:campaigns.id});
    created.campaignId=campaign.id;

    const message=await waitFor("Campaign pipeline",180000,async()=>{
      const m=await pool.query("select id,status,last_error,accepted_at,delivered_at,bounced_at from messages where campaign_id=$1 order by queued_at desc limit 1",[campaign.id]);
      if(!m.rows[0]) return null;
      created.messageId=m.rows[0].id;
      if(["mta_accepted","delivered","bounced","failed"].includes(m.rows[0].status)) return m.rows[0];
      return null;
    });
    if(message){
      record("Campaign -> transport",["mta_accepted","delivered"].includes(message.status)?"PASS":"WARN",JSON.stringify(message));

      const openToken=await signPublicToken({messageId:message.id},"30d");
      const clickToken=await signPublicToken({messageId:message.id,url:"https://example.com/"},"30d");
      const unsubscribeToken=await signPublicToken({messageId:message.id,email:testEmail},"30d");
      const commonHeaders={"user-agent":"Mozilla/5.0 NexiMailAcceptance/1.0","accept-language":"en-US,en;q=0.9"};
      const openRes=await fetch(`${baseUrl}/tracking/open/${openToken}`,{headers:commonHeaders});
      const clickRes=await fetch(`${baseUrl}/tracking/click/${clickToken}`,{headers:commonHeaders,redirect:"manual"});
      const unsubGet=await fetch(`${baseUrl}/unsubscribe/${unsubscribeToken}`,{headers:commonHeaders});
      const unsubPost=await fetch(`${baseUrl}/unsubscribe/${unsubscribeToken}`,{method:"POST",headers:commonHeaders});
      await sleep(1000);
      const ev=await pool.query("select type,count(*)::int count from message_events where message_id=$1 and type in ('open','click','unsubscribe') group by type",[message.id]);
      const sup=await pool.query("select reason,source from suppressions where normalized_email=lower($1)",[testEmail]);
      const types=new Set(ev.rows.map(r=>r.type));
      const ok=openRes.status===200 && clickRes.status===302 && unsubGet.status===200 && unsubPost.status===200 && types.has("open") && types.has("click") && types.has("unsubscribe") && sup.rows[0]?.reason==="unsubscribe";
      record("Tracking + unsubscribe",ok?"PASS":"FAIL",`HTTP open=${openRes.status},click=${clickRes.status},unsubGET=${unsubGet.status},unsubPOST=${unsubPost.status}; events=${[...types].join(",")}; suppression=${sup.rows[0]?.reason||"none"}`);
    }
  } else {
    record("Campaign -> transport","WARN",`requires active Gmail seed inbox + active sending account + imported test contact (seed=${Boolean(seed)}, account=${Boolean(account)}, contact=${Boolean(created.contactId)})`);
  }

  let bounceBaseCampaignId:string|undefined;
  const campaignCount=await pool.query("select count(*)::int count from campaigns");
  if(Number(campaignCount.rows[0]?.count||0)===0 && created.contactId){
    const [base]=await db.insert(campaigns).values({name:`__acceptance_bounce_base_${stamp}`,subject:"Acceptance bounce base",status:"draft"}).returning({id:campaigns.id});
    bounceBaseCampaignId=base.id;
  }
  const bounceCode=await runBounceSmoke();
  record("Bounce processing",bounceCode===0?"PASS":"FAIL",`npm run smoke:bounce exit=${bounceCode}`);
  if(bounceBaseCampaignId) await db.delete(campaigns).where(eq(campaigns.id,bounceBaseCampaignId));

  // Cleanup only when the test campaign is terminal or was never created.
  // If Postfix has accepted a message but it is still in flight, retain the rows
  // so postfix-event-worker can finish safely instead of deleting its target.
  let safeCleanup=true;
  if(created.messageId){
    const m=await pool.query("select status from messages where id=$1",[created.messageId]);
    safeCleanup=!m.rows[0] || ["delivered","bounced","failed","cancelled"].includes(m.rows[0].status);
  }
  if(safeCleanup){
    if(created.campaignId) await db.delete(campaigns).where(eq(campaigns.id,created.campaignId));
    if(created.templateId) await db.delete(templates).where(eq(templates.id,created.templateId));
    if(created.listId) await db.delete(lists).where(eq(lists.id,created.listId));
    if(created.email) await db.delete(suppressions).where(eq(suppressions.normalizedEmail,created.email.toLowerCase()));
    if(created.contactId) await db.delete(contacts).where(eq(contacts.id,created.contactId));
    if(created.importJobId) await db.delete(importJobs).where(eq(importJobs.id,created.importJobId));
    record("Acceptance cleanup","PASS","temporary rows removed");
  } else record("Acceptance cleanup","WARN",`message ${created.messageId} is still in flight; test rows retained intentionally`);

  const fail=results.some(r=>r.status==="FAIL");
  const warn=results.some(r=>r.status==="WARN");
  console.log("\n=== NEXIMAIL PRODUCTION ACCEPTANCE SUMMARY ===");
  for(const r of results) console.log(`${r.status.padEnd(4)}  ${r.check}: ${r.detail}`);
  console.log(`\nRESULT=${fail?"FAIL":warn?"PASS_WITH_WARNINGS":"PASS"}`);
  process.exitCode=fail?1:0;
}

main().catch(async(error)=>{
  console.error("[FAIL] production acceptance:",error);
  process.exitCode=1;
}).finally(()=>pool.end());
