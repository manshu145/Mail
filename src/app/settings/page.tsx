import { KeyRound, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { systemSettings } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let rows: typeof systemSettings.$inferSelect[] = [];
  let dbError = false;
  if (databaseConfigured) {
    try { rows = (await db.select().from(systemSettings)).filter((row) => row.key !== "validation.supersend_api_key"); } catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;

  return (
    <AppShell session={session}>
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="page-eyebrow mb-2">Workspace</p><h1 className="page-title">Settings</h1><p className="page-description">Manage workspace-level defaults and application behavior from one place.</p></div>
        <ResourceCreate disabled={!usable || session.role !== "owner"} endpoint="/api/resources/settings" title="Save workspace setting" buttonLabel="Add setting" fields={[{name:"key",label:"Setting key",required:true,placeholder:"campaign.default_from_name"},{name:"value",label:"Value",required:true,placeholder:"NexiMail"}]} />
      </div>

      {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Settings storage unavailable.</b> Check the database connection.</div> : null}

      <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <article className="premium-panel overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Overrides</p><h2 className="mt-1 text-lg font-black">Workspace defaults</h2></div>
          {rows.length ? <div className="divide-y divide-[var(--border)]">{rows.map((row) => <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6" key={row.key}><div className="min-w-0"><div className="font-mono text-sm font-bold">{row.key}</div><div className="mt-1 max-w-xl truncate text-xs text-[var(--muted)]">{JSON.stringify(row.value)}</div></div><span className="shrink-0 text-xs font-bold text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle:"medium"}).format(row.updatedAt)}</span></div>)}</div> : <div className="grid min-h-64 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--surface-soft)] text-[var(--muted)]"><Settings2 className="h-5 w-5" /></div><h2 className="mt-4 font-black">No workspace overrides</h2><p className="mt-1 text-sm text-[var(--muted)]">Add a setting when you need to override a default.</p></div></div>}
        </article>

        <aside className="space-y-4">
          <article className="premium-panel p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-black">Security boundary</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">SMTP passwords, database URLs, Redis URLs, DKIM private keys and signing secrets are never stored as normal workspace settings.</p></div></div></article>
          <article className="premium-panel p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><SlidersHorizontal className="h-5 w-5" /></div><div><h2 className="font-black">Runtime controls</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Sending limits and reputation controls stay in their dedicated operational modules.</p></div></div></article>
          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-5"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-violet-600" /><span className="text-sm font-bold">Signed-in role</span></div><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-black capitalize text-violet-700 dark:text-violet-300">{session.role}</span></div></article>
        </aside>
      </section>
    </AppShell>
  );
}
