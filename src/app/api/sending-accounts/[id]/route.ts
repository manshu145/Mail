import { NextRequest,NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db,databaseConfigured } from "@/db";
import { sendingAccounts } from "@/db/schema";
import { canManageInfrastructure,getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isUuid } from "@/lib/id";

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const session=await getSession();
  if(!session)return NextResponse.json({error:"Unauthorized"},{status:401});
  if(!canManageInfrastructure(session.role))return NextResponse.json({error:"Owner role required"},{status:403});
  if(!databaseConfigured)return NextResponse.json({error:"Database unavailable"},{status:503});
  const {id}=await params;
  if(!isUuid(id))return NextResponse.json({error:"Invalid sending account id"},{status:400});
  const b=await request.json().catch(()=>null) as {status?:string;hourlyLimit?:number;dailyLimit?:number}|null;
  if(!b)return NextResponse.json({error:"Invalid request."},{status:400});
  const status=b.status==="active"||b.status==="paused"||b.status==="disabled"?b.status:undefined;
  const hourly=b.hourlyLimit!==undefined&&Number.isFinite(Number(b.hourlyLimit))?Math.max(0,Math.floor(Number(b.hourlyLimit))):undefined;
  const daily=b.dailyLimit!==undefined&&Number.isFinite(Number(b.dailyLimit))?Math.max(0,Math.floor(Number(b.dailyLimit))):undefined;
  if(status===undefined&&hourly===undefined&&daily===undefined)return NextResponse.json({error:"Nothing to update"},{status:400});
  const rows=await db.update(sendingAccounts).set({
    ...(status?{status}:{}),
    ...(hourly!==undefined?{hourlyLimit:hourly}:{}),
    ...(daily!==undefined?{dailyLimit:daily}:{}),
    updatedAt:new Date(),
  }).where(eq(sendingAccounts.id,id)).returning({id:sendingAccounts.id});
  if(!rows.length)return NextResponse.json({error:"Sending account not found"},{status:404});
  await audit("sending_account.updated",session,"sending_account",id,{status,hourly,daily,zeroMeansUnlimited:true});
  return NextResponse.json({ok:true});
}
