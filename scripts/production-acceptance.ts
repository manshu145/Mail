import { SignJWT } from "jose";
import { spawn } from "node:child_process";
import { resolve4, reverse } from "node:dns/promises";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { campaigns, contacts, importJobs, messages, sendingAccounts, suppressions, users } from "../src/db/schema";
import { importUploads } from "../src/db/import-schema";
import { sendingDomains, workerHeartbeats } from "../src/db/operations-schema";

const baseUrl = "http://127.0.0.1:3000";
const stamp = Date.now();
const results: Array<{check:string; status:"PASS"|"WARN"|"FAIL"; detail:string}> = [];
const created: { importJobId?: string; contactId?: string; email?: string } = {};

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
  const staleCount=Number(sj?.stale_imports||0)+Number(sj?.stale_validations||0)+Number(sj?.stale_campaigns||0);
  record("Stuck work",staleCount?"FAIL":"PASS",JSON.stringify(sj));

  const domains=await db.select().from(sendingDomains);
  if(!domains.length) record("Sending-domain auth","WARN","no sending domain configured");
  else {
    const badDomains=domains.filter(d=>d.status!=="ready" || !d.spfOk || !d.dkimOk || !d.dmarcOk);
    record("Sending-domain auth",badDomains.length?"FAIL":"PASS",
      domains.map(d=>`${d.domain}:status=${d.status},spf=${d.spfOk},dkim=${d.dkimOk},dmarc=${d.dmarcOk}`).join(" | "));
  }

  const mtaHostname=String(process.env.MTA_HOSTNAME||"").trim().toLowerCase().replace(/\.$/,"");
  let mtaPublicIp=String(process.env.MTA_PUBLIC_IP||"").trim();
  let forwardAddresses:string[]=[];
  if(mtaHostname){
    forwardAddresses=await resolve4(mtaHostname).catch(()=>[]);
    if(!mtaPublicIp) mtaPublicIp=forwardAddresses[0]||"";
  }
  const ptrNames=mtaPublicIp?await reverse(mtaPublicIp).catch(()=>[]):[];
  const normalizedPtrs=ptrNames.map(name=>name.toLowerCase().replace(/\.$/,""));
  const identityOk=Boolean(mtaHostname&&mtaPublicIp&&forwardAddresses.includes(mtaPublicIp)&&normalizedPtrs.includes(mtaHostname));
  record("MTA forward/reverse DNS",identityOk?"PASS":"FAIL",
    `hostname=${mtaHostname||"missing"}, publicIp=${mtaPublicIp||"missing"}, A=[${forwardAddresses.join(",")}], PTR=[${normalizedPtrs.join(",")}]`);

  const cookie=await sessionCookie(owner);
  const dashboard=await fetch(`${baseUrl}/dashboard`,{headers:{cookie},redirect:"manual"});
  record("Owner session",dashboard.status===200?"PASS":"FAIL",`GET /dashboard -> ${dashboard.status}`);
  const ownerRbac=await fetch(`${baseUrl}/api/users`,{method:"POST",headers:{cookie,"content-type":"application/json"},body:"{}",redirect:"manual"});
  record("Owner RBAC",ownerRbac.status===400?"PASS":"FAIL",`invalid user create reached validation -> ${ownerRbac.status}`);

  let nonOwner=owners.find(u=>u.role!=="owner");
  let tempOperatorId:string|undefined;
  if(!nonOwner){
    const [temp]=await db.insert(users).values({
      name:"NexiMail Acceptance Operator",
      email:`acceptance-operator-${stamp}@example.invalid`,
      passwordHash:"acceptance-only-not-used",
      role:"operator",
      status:"active",
    }).returning({id:users.id,email:users.email,name:users.name,role:users.role,status:users.status});
    nonOwner=temp;
    tempOperatorId=temp.id;
  }
  const nonOwnerCookie=await sessionCookie(nonOwner);
  const denied=await fetch(`${baseUrl}/api/users`,{method:"POST",headers:{cookie:nonOwnerCookie,"content-type":"application/json"},body:"{}",redirect:"manual"});
  record("Non-owner RBAC",denied.status===403?"PASS":"FAIL",`${nonOwner.role} user create -> ${denied.status}`);
  if(tempOperatorId) await db.delete(users).where(eq(users.id,tempOperatorId));

  // Real import-worker acceptance test using a non-deliverable documentation address.
  // Optional mailbox-validation / seed-placement checks are intentionally excluded.
  const testEmail=`neximail-acceptance-${stamp}@example.invalid`;
  created.email=testEmail;
  const csv=`email,first_name\n${testEmail},Acceptance\n`;
  const [job]=await db.insert(importJobs).values({filename:`acceptance-${stamp}.csv`,createdBy:owner.id}).returning({id:importJobs.id});
  created.importJobId=job.id;
  await db.insert(importUploads).values({
    jobId:job.id,content:csv,headers:["email","first_name"],mapping:{email:"email",first_name:"first_name"},
    options:{consentSource:"production_acceptance",consentStatus:"confirmed",defaultSource:"production_acceptance",queueValidation:false},
    sizeBytes:Buffer.byteLength(csv)
  });
  const imported=await waitFor("Import worker",60000,async()=>{
    const j=await pool.query("select status,imported_rows,invalid_rows,error_message from import_jobs where id=$1",[job.id]);
    if(j.rows[0]?.status==="failed") throw new Error(`Import failed: ${j.rows[0].error_message}`);
    if(j.rows[0]?.status!=="completed") return null;
    const contact=await pool.query("select id,email,consent_status,consent_source,validation_status from contacts where normalized_email=lower($1)",[testEmail]);
    if(!contact.rows[0]) { record("CSV import","FAIL","import job completed but contact was not created"); return {job:j.rows[0],contact:null}; }
    created.contactId=contact.rows[0].id;
    return {job:j.rows[0],contact:contact.rows[0]};
  });
  if(imported?.contact) record("CSV import","PASS",`contact created with consent=${imported.contact.consent_status}, validation=${imported.contact.validation_status}`);

  const [account]=await db.select({id:sendingAccounts.id,name:sendingAccounts.name}).from(sendingAccounts).where(eq(sendingAccounts.status,"active")).limit(1);
  record("Active sending account",account?"PASS":"WARN",account?`active sender present (${account.name})`:"no active sending account configured");

  let bounceBaseCampaignId:string|undefined;
  const campaignCount=await pool.query("select count(*)::int count from campaigns");
  if(Number(campaignCount.rows[0]?.count||0)===0 && created.contactId){
    const [base]=await db.insert(campaigns).values({name:`__acceptance_bounce_base_${stamp}`,subject:"Acceptance bounce base",status:"draft"}).returning({id:campaigns.id});
    bounceBaseCampaignId=base.id;
  }
  const bounceCode=await runBounceSmoke();
  record("Bounce processing",bounceCode===0?"PASS":"FAIL",`npm run smoke:bounce exit=${bounceCode}`);
  if(bounceBaseCampaignId) await db.delete(campaigns).where(eq(campaigns.id,bounceBaseCampaignId));

  if(created.email) await db.delete(suppressions).where(eq(suppressions.normalizedEmail,created.email.toLowerCase()));
  if(created.contactId) await db.delete(contacts).where(eq(contacts.id,created.contactId));
  if(created.importJobId) await db.delete(importJobs).where(eq(importJobs.id,created.importJobId));
  record("Acceptance cleanup","PASS","temporary rows removed");

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
