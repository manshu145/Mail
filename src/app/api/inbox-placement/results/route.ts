import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { inboxTestResults, inboxTests, seedInboxes } from "@/db/operations-schema";
const allowed=["inbox","promotions","updates","spam","not_found"] as const;
export async function POST(request:NextRequest){
 if(!databaseConfigured)return NextResponse.json({error:"Database unavailable"},{status:503});const secret=process.env.SEED_AGENT_SECRET;if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await request.json().catch(()=>null) as {testId?:string;seedEmail?:string;category?:typeof allowed[number];detail?:string}|null;if(!body?.testId||!body.seedEmail||!allowed.includes(body.category as typeof allowed[number]))return NextResponse.json({error:"Invalid result"},{status:400});
 const [seed]=await db.select().from(seedInboxes).where(eq(seedInboxes.email,body.seedEmail.toLowerCase())).limit(1);const [test]=await db.select().from(inboxTests).where(eq(inboxTests.id,body.testId)).limit(1);if(!seed||!test)return NextResponse.json({error:"Unknown test or seed"},{status:404});
 const existing=await db.select({id:inboxTestResults.id}).from(inboxTestResults).where(and(eq(inboxTestResults.testId,test.id),eq(inboxTestResults.seedInboxId,seed.id))).limit(1);if(existing.length)return NextResponse.json({error:"Result already recorded"},{status:409});
 await db.insert(inboxTestResults).values({testId:test.id,seedInboxId:seed.id,category:body.category!,detail:body.detail?.slice(0,1000)||null});await db.update(inboxTests).set({status:"running"}).where(eq(inboxTests.id,test.id));
 const [counts]=await db.execute(sql`select (select count(*) from seed_inboxes where active=true)::int as expected,(select count(*) from inbox_test_results where test_id=${test.id})::int as observed` ).then(r=>r.rows as unknown as [{expected:number;observed:number}]);if(Number(counts?.observed)>=Number(counts?.expected)&&Number(counts?.expected)>0)await db.update(inboxTests).set({status:"completed",completedAt:new Date()}).where(eq(inboxTests.id,test.id));
 return NextResponse.json({ok:true});
}
