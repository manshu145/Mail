import { FileText } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { templates } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function TemplatesPage() {
  const session = await getSession(); if (!session) redirect("/login");
  let rows: typeof templates.$inferSelect[] = []; let dbError = false;
  if (databaseConfigured) { try { rows = await db.select().from(templates).orderBy(desc(templates.updatedAt)); } catch { dbError = true; } }
  const usable = databaseConfigured && !dbError;
  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Messaging</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Templates</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">Reusable email content with separate HTML and plain-text bodies. Personalization and unsubscribe variables will be resolved at send time.</p></div><ResourceCreate disabled={!usable} endpoint="/api/resources/templates" title="Create template" buttonLabel="New template" fields={[{name:"name",label:"Template name",required:true,placeholder:"September offer"},{name:"subject",label:"Default subject",placeholder:"A useful subject line"},{name:"htmlBody",label:"HTML body",type:"textarea",placeholder:"<h1>Hello {{first_name}}</h1>"},{name:"textBody",label:"Plain-text body",type:"textarea",placeholder:"Hello {{first_name}}"}]} /></div>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.length ? rows.map((row) => <article className="premium-panel p-5" key={row.id}><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"><FileText className="h-5 w-5" /></div><h2 className="mt-5 text-lg font-black">{row.name}</h2><p className="mt-1 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">{row.subject || "No default subject"}</p><div className="mt-5 flex gap-2 text-[11px] font-extrabold uppercase tracking-[.1em] text-zinc-400"><span>{row.htmlBody ? "HTML" : "No HTML"}</span><span>·</span><span>{row.textBody ? "Text" : "No text"}</span></div></article>) : <div className="premium-panel col-span-full grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-zinc-900"><FileText className="h-5 w-5" /></div><h2 className="mt-4 font-black">No templates yet</h2><p className="mt-1 text-sm text-zinc-500">Create reusable content without inventing campaign activity.</p></div></div>}</section>
  </AppShell>;
}
