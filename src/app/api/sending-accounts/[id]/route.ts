import { NextRequest,NextResponse } from "next/server";
import { and,eq,ne } from "drizzle-orm";
import { db,databaseConfigured } from "@/db";
import { sendingAccounts } from "@/db/schema";
import { canManageInfrastructure,getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isValidEmail } from "@/lib/contact-utils";
import { isUuid } from "@/lib/id";

type PatchBody={
  status?:string;
  hourlyLimit?:number;
  dailyLimit?:number;
  name?:string;
  fromName?:string;
  fromEmail?:string;
  replyTo?:string|null;
};

function clean(value:unknown){return String(value??"").trim()}

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const session=await getSession();
  if(!session)return NextResponse.json({error:"Unauthorized"},{status:401});
  if(!canManageInfrastructure(session.role))return NextResponse.json({error:"Owner role required"},{status:403});
  if(!databaseConfigured)return NextResponse.json({error:"Database unavailable"},{status:503});

  const {id}=await params;
  if(!isUuid(id))return NextResponse.json({error:"Invalid sending account id"},{status:400});

  const b=await request.json().catch(()=>null) as PatchBody|null;
  if(!b)return NextResponse.json({error:"Invalid request."},{status:400});

  const status=b.status==="active"||b.status==="paused"||b.status==="disabled"?b.status:undefined;
  const hourly=b.hourlyLimit!==undefined&&Number.isFinite(Number(b.hourlyLimit))?Math.max(0,Math.floor(Number(b.hourlyLimit))):undefined;
  const daily=b.dailyLimit!==undefined&&Number.isFinite(Number(b.dailyLimit))?Math.max(0,Math.floor(Number(b.dailyLimit))):undefined;

  const hasName=Object.prototype.hasOwnProperty.call(b,"name");
  const hasFromName=Object.prototype.hasOwnProperty.call(b,"fromName");
  const hasFromEmail=Object.prototype.hasOwnProperty.call(b,"fromEmail");
  const hasReplyTo=Object.prototype.hasOwnProperty.call(b,"replyTo");

  const name=hasName?clean(b.name):undefined;
  const fromName=hasFromName?clean(b.fromName):undefined;
  const fromEmail=hasFromEmail?clean(b.fromEmail).toLowerCase():undefined;
  const replyTo=hasReplyTo?clean(b.replyTo).toLowerCase():undefined;

  if(hasName&&!name)return NextResponse.json({error:"Identity name is required."},{status:400});
  if(hasFromName&&!fromName)return NextResponse.json({error:"From name is required."},{status:400});
  if(hasFromEmail&&(!fromEmail||!isValidEmail(fromEmail)))return NextResponse.json({error:"Enter a valid From email address."},{status:400});
  if(hasReplyTo&&replyTo&&!isValidEmail(replyTo))return NextResponse.json({error:"Reply-to must be a valid email address."},{status:400});

  if(name){
    const [duplicate]=await db.select({id:sendingAccounts.id}).from(sendingAccounts)
      .where(and(eq(sendingAccounts.name,name),ne(sendingAccounts.id,id))).limit(1);
    if(duplicate)return NextResponse.json({error:"A sending account with this name already exists."},{status:409});
  }

  if(
    status===undefined&&hourly===undefined&&daily===undefined&&
    !hasName&&!hasFromName&&!hasFromEmail&&!hasReplyTo
  )return NextResponse.json({error:"Nothing to update"},{status:400});

  const rows=await db.update(sendingAccounts).set({
    ...(status?{status}:{}),
    ...(hourly!==undefined?{hourlyLimit:hourly}:{}),
    ...(daily!==undefined?{dailyLimit:daily}:{}),
    ...(hasName?{name}:{}),
    ...(hasFromName?{fromName}:{}),
    ...(hasFromEmail?{fromEmail}:{}),
    ...(hasReplyTo?{replyTo:replyTo||null}:{}),
    updatedAt:new Date(),
  }).where(eq(sendingAccounts.id,id)).returning({id:sendingAccounts.id});

  if(!rows.length)return NextResponse.json({error:"Sending account not found"},{status:404});

  await audit("sending_account.updated",session,"sending_account",id,{
    status,hourly,daily,
    editedIdentity:hasName||hasFromName||hasFromEmail||hasReplyTo,
    zeroMeansUnlimited:true
  });
  return NextResponse.json({ok:true});
}
