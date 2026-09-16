import { KeyRound, LockKeyhole, ShieldCheck, TerminalSquare } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ApiKeyManager, ApiKeyRevoke } from "@/components/api-key-manager";
import { db, databaseConfigured } from "@/db";
import { apiKeys } from "@/db/integration-schema";
import { getSession } from "@/lib/auth";

export default async function ApiKeysPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/dashboard");

  let rows: typeof apiKeys.$inferSelect[] = [];
  let failed = false;
  if (databaseConfigured) {
    try { rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)); }
    catch { failed = true; }
  }
  const usable = databaseConfigured && !failed;

  return (
    <AppShell session={session}>
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="page-eyebrow mb-2">Developer platform</p><h1 className="page-title">API keys</h1><p className="page-description">Create scoped credentials for the NexiMail API. Raw secrets are returned once and only hashes are stored.</p></div>
        <ApiKeyManager disabled={!usable} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <article className="premium-panel overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Credentials</p><h2 className="mt-1 text-lg font-black">Workspace keys</h2></div>
          {rows.length ? <div className="divide-y divide-[var(--border)]">{rows.map((row) => <div key={row.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-black">{row.name}</p><code className="rounded-md bg-[var(--surface-soft)] px-2 py-1 text-[10px] font-bold">{row.keyPrefix}…</code>{row.revokedAt ? <span className="rounded-full bg-rose-500/10 px-2 py-1 text-[10px] font-black text-rose-600">Revoked</span> : <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-600">Active</span>}</div><div className="mt-2 flex flex-wrap gap-1.5">{row.scopes.map((scope) => <span key={scope} className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-bold text-[var(--muted)]">{scope}</span>)}</div><p className="mt-2 text-[11px] text-[var(--muted)]">Created {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(row.createdAt)} · Last used {row.lastUsedAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(row.lastUsedAt) : "never"}</p></div><ApiKeyRevoke id={row.id} disabled={Boolean(row.revokedAt)} /></div>)}</div> : <div className="grid min-h-72 place-items-center p-8 text-center"><div className="max-w-md"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><KeyRound className="h-5 w-5" /></div><h3 className="mt-4 font-black">No API credentials yet</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Create a scoped key when an integration needs programmatic access.</p></div></div>}
        </article>

        <aside className="space-y-4">
          <article className="premium-panel p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-black">Secret-safe lifecycle</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">New secrets are shown once. Storage contains only a SHA-256 hash and visible prefix; revocation is immediate.</p></div></div></article>
          <article className="premium-panel p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300"><TerminalSquare className="h-5 w-5" /></div><div><h2 className="font-black">REST API</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Bearer keys authenticate <code>/api/v1/contacts</code> and <code>/api/v1/campaigns</code> according to their scopes.</p></div></div></article>
          {!usable ? <article className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.055] p-5"><div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><p className="text-sm leading-6 text-[var(--muted)]">Credential storage is unavailable. Check the database connection.</p></div></article> : null}
        </aside>
      </section>
    </AppShell>
  );
}
