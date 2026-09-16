import { KeyRound, LockKeyhole, ShieldCheck, TerminalSquare } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";

export default async function ApiKeysPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AppShell session={session}>
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-eyebrow mb-2">Developer platform</p>
          <h1 className="page-title">API keys</h1>
          <p className="page-description">Manage credentials for REST API access and authenticated SMTP submission without exposing raw secrets after creation.</p>
        </div>
        <button disabled className="btn-primary opacity-45"><KeyRound className="h-4 w-4" /> Create API key</button>
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <article className="premium-panel overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Credentials</p><h2 className="mt-1 text-lg font-black">Workspace keys</h2></div>
          <div className="grid min-h-72 place-items-center p-8 text-center">
            <div className="max-w-md"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><KeyRound className="h-5 w-5" /></div><h3 className="mt-4 font-black">No preview API credentials</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">The VPS build stores hashed keys with prefixes, scopes and revocation state. Secret creation remains disabled here until this control plane is connected to that runtime.</p></div>
          </div>
        </article>

        <aside className="space-y-4">
          <article className="premium-panel p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-black">Secret-safe lifecycle</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Show a new secret once, persist only the secure hash, keep a visible prefix for identification and support immediate revocation.</p></div></div></article>
          <article className="premium-panel p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300"><TerminalSquare className="h-5 w-5" /></div><div><h2 className="font-black">Scoped access</h2><div className="mt-3 flex flex-wrap gap-2">{["contacts:read","contacts:write","campaigns:read","campaigns:write","smtp:submit"].map((scope) => <code key={scope} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[11px] font-bold">{scope}</code>)}</div></div></div></article>
          <article className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.055] p-5"><div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><p className="text-sm leading-6 text-[var(--muted)]"><b className="text-[var(--foreground)]">VPS integration required.</b> This screen intentionally does not invent credentials in the Vercel preview environment.</p></div></article>
        </aside>
      </section>
    </AppShell>
  );
}
