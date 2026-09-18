import Link from "next/link";
import { FileText } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { TemplatePresetLibrary } from "@/components/template-preset-library";
import { db, databaseConfigured } from "@/db";
import { templates } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function TemplatesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  let rows: typeof templates.$inferSelect[] = [];
  let bad = false;
  if (databaseConfigured) try { rows = await db.select().from(templates).orderBy(desc(templates.updatedAt)); } catch { bad = true; }
  const usable = databaseConfigured && !bad;

  return <AppShell session={session}>
    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="page-eyebrow">Messaging</p><h1 className="mt-2 page-title">Templates</h1><p className="page-description">Build polished reusable email designs with HTML, plain text, personalization and live preview.</p></div>
      <ResourceCreate disabled={!usable} endpoint="/api/resources/templates" title="Create blank template" buttonLabel="Blank template" fields={[{name:"name",label:"Template name",required:true},{name:"subject",label:"Default subject"},{name:"htmlBody",label:"HTML body",type:"textarea"},{name:"textBody",label:"Plain-text body",type:"textarea"}]}/>
    </div>

    {usable ? <TemplatePresetLibrary /> : null}

    <div className="mb-2.5"><p className="page-eyebrow">Your workspace</p><h2 className="mt-1 text-lg font-black">Saved templates</h2></div>
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.length ? rows.map((r) => <Link href={`/templates/${r.id}`} className="premium-panel block p-4" key={r.id}>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"><FileText className="h-4 w-4"/></div>
        <h2 className="mt-3.5 text-[15px] font-black">{r.name}</h2>
        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{r.subject || "No default subject"}</p>
        <div className="mt-3.5 text-[10px] font-extrabold uppercase tracking-[.1em] text-zinc-400">{r.htmlBody ? "HTML" : "No HTML"} · {r.textBody ? "Text" : "No text"}</div>
      </Link>) : <div className="premium-panel col-span-full grid min-h-52 place-items-center text-center"><div><FileText className="mx-auto h-8 w-8 text-zinc-400"/><h2 className="mt-4 font-black">No saved templates yet</h2><p className="mt-1 text-sm text-zinc-500">Choose a prebuilt design above or create a blank template.</p></div></div>}
    </section>
  </AppShell>;
}
