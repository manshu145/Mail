import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, contacts, lists, sendingAccounts, suppressions, templates, validationJobs } from "@/db/schema";
import { sendingDomains } from "@/db/operations-schema";
import { getSession, canManageInfrastructure } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isValidEmail, normalizeEmail } from "@/lib/contact-utils";
import { createDkimMaterial } from "@/lib/dkim-keys";
function text(value:unknown){return String(value??"").trim()}
export async function POST(request:NextRequest,{params}:{params:Promise<{resource:string}>}){
 const session=await getSession();if(!session)return NextResponse.json({error:"Unauthorized"},{status:401});if(!databaseConfigured)return NextResponse.json({error:"Database is not configured."},{status:503});
 const {resource}=await params;const body=await request.json().catch(()=>null) as Record<string,unknown>|null;if(!body)return NextResponse.json({error:"Invalid request."},{status:400});
 try{
  if(resource==="lists"){const name=text(body.name);if(!name)return NextResponse.json({error:"List name is required."},{status:400});const rows=await db.insert(lists).values({name,description:text(body.description)||null,isDynamic:text(body.type)==="dynamic"}).onConflictDoNothing({target:lists.name}).returning({id:lists.id});if(!rows.length)return NextResponse.json({error:"A list with this name already exists."},{status:409});await audit("list.created",session,"list",rows[0].id,{name});return NextResponse.json({ok:true,id:rows[0].id},{status:201})}
  if(resource==="suppressions"){const email=text(body.email).toLowerCase();if(!isValidEmail(email))return NextResponse.json({error:"Enter a valid email address."},{status:400});const allowed=["unsubscribe","hard_bounce","bounce","manual","invalid","complaint","policy"] as const;const reason=allowed.includes(text(body.reason) as typeof allowed[number])?text(body.reason) as typeof allowed[number]:"manual";const rows=await db.insert(suppressions).values({email,normalizedEmail:normalizeEmail(email),reason,note:text(body.note)||null}).onConflictDoNothing({target:suppressions.normalizedEmail}).returning({id:suppressions.id});if(!rows.length)return NextResponse.json({error:"Address is already suppressed."},{status:409});await audit("suppression.created",session,"suppression",rows[0].id,{email,reason});return NextResponse.json({ok:true,id:rows[0].id},{status:201})}
  if(resource==="templates"){const name=text(body.name),subject=text(body.subject),htmlBody=text(body.htmlBody),textBody=text(body.textBody);if(!name)return NextResponse.json({error:"Template name is required."},{status:400});const rows=await db.insert(templates).values({name,subject:subject||null,htmlBody,textBody}).onConflictDoNothing({target:templates.name}).returning({id:templates.id});if(!rows.length)return NextResponse.json({error:"A template with this name already exists."},{status:409});await audit("template.created",session,"template",rows[0].id,{name});return NextResponse.json({ok:true,id:rows[0].id},{status:201})}
  if(resource==="campaigns"){const name=text(body.name),subject=text(body.subject);if(!name||!subject)return NextResponse.json({error:"Campaign name and subject are required."},{status:400});const rows=await db.insert(campaigns).values({name,subject,preheader:text(body.preheader)||null,status:"draft"}).returning({id:campaigns.id});await audit("campaign.created",session,"campaign",rows[0].id,{name});return NextResponse.json({ok:true,id:rows[0].id},{status:201})}
  if(resource==="sending-accounts"){if(!canManageInfrastructure(session.role))return NextResponse.json({error:"Owner role required."},{status:403});const name=text(body.name),fromName=text(body.fromName),fromEmail=text(body.fromEmail).toLowerCase(),replyTo=text(body.replyTo).toLowerCase();if(!name||!fromName||!isValidEmail(fromEmail))return NextResponse.json({error:"Name, sender name and a valid sender email are required."},{status:400});if(replyTo&&!isValidEmail(replyTo))return NextResponse.json({error:"Reply-to must be a valid email address."},{status:400});const rows=await db.insert(sendingAccounts).values({name,fromName,fromEmail,replyTo:replyTo||null,transportType:"postfix",hourlyLimit:0,dailyLimit:0}).onConflictDoNothing({target:sendingAccounts.name}).returning({id:sendingAccounts.id});if(!rows.length)return NextResponse.json({error:"A sending account with this name already exists."},{status:409});await audit("sending_account.created",session,"sending_account",rows[0].id,{name,fromEmail});return NextResponse.json({ok:true,id:rows[0].id},{status:201})}
  if(resource==="validation-jobs"){
   const active=await db.execute(sql`select id::text,scope,status::text,total_rows,processed_rows from validation_jobs where status in ('pending','processing') order by created_at asc limit 1`);
   const current=active.rows[0] as Record<string,unknown>|undefined;
   if(current)return NextResponse.json({error:"A validation job is already active.",activeJob:{id:String(current.id),scope:String(current.scope),status:String(current.status),total:Number(current.total_rows||0),processed:Number(current.processed_rows||0)}},{status:409});
   const [countRow]=await db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com$' and ${contacts.status}='active'`);
   const total=countRow?.value??0;
   if(!total)return NextResponse.json({error:"No active Gmail / Googlemail contacts are available for validation."},{status:409});
   const rows=await db.insert(validationJobs).values({scope:"gmail",totalRows:total,status:"pending"}).returning({id:validationJobs.id});await audit("validation.queued",session,"validation_job",rows[0].id,{total});return NextResponse.json({ok:true,id:rows[0].id,total},{status:201})
  }
  if(resource==="settings"){return NextResponse.json({error:"Generic settings updates are disabled. Use the dedicated settings controls."},{status:410})}
  if(resource==="domains"){
   if(!canManageInfrastructure(session.role))return NextResponse.json({error:"Owner role required."},{status:403});
   const domain=text(body.domain).toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,"");
   if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain))return NextResponse.json({error:"Enter a valid domain."},{status:400});
   const selector=(text(body.dkimSelector)||"default").toLowerCase();
   if(!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(selector))return NextResponse.json({error:"Enter a valid DKIM selector."},{status:400});
   const requestedBounceDomain=text(body.bounceDomain).toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,"");
   const bounceDomain=requestedBounceDomain||`nm-bounce.${domain}`;
   if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(bounceDomain))return NextResponse.json({error:"Enter a valid bounce domain."},{status:400});
   if(bounceDomain===domain)return NextResponse.json({error:"Bounce domain must be a subdomain or separate domain, not the sending domain itself."},{status:400});
   const dkim=createDkimMaterial(selector);
   const rows=await db.insert(sendingDomains).values({domain,trackingDomain:text(body.trackingDomain)||null,bounceDomain,dkimSelector:dkim.selector,dkimPublicKey:dkim.publicKey,dkimPrivateKeyCiphertext:dkim.privateKeyCiphertext}).onConflictDoNothing({target:sendingDomains.domain}).returning({id:sendingDomains.id});
   if(!rows.length)return NextResponse.json({error:"Domain already exists."},{status:409});
   await audit("domain.created",session,"domain",rows[0].id,{domain,dkimSelector:selector,bounceDomain});
   return NextResponse.json({ok:true,id:rows[0].id,dkim:{host:`${selector}._domainkey.${domain}`,type:"TXT",value:dkim.publicRecord},bounce:{domain:bounceDomain,mx:process.env.MTA_HOSTNAME||null,spfIp:process.env.MTA_PUBLIC_IP||null}},{status:201})
  }
  return NextResponse.json({error:"Unknown resource."},{status:404});
 }catch(error){console.error(error);return NextResponse.json({error:"Could not save this resource."},{status:500})}
}
