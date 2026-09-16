import { Activity, BadgeCheck, RefreshCw, ShieldCheck, Webhook } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { WebhookActions, WebhookCreate } from "@/components/webhook-manager";
import { db, databaseConfigured } from "@/db";
import { webhookEndpoints } from "@/db/integration-schema";
import { getSession } from "@/lib/auth";

const events = ["message.delivered","message.bounced","message.opened","message.clicked","contact.unsubscribed"];

export default async function WebhooksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/dashboard");

  let endpoints: typeof webhookEndpoints.$inferSelect[] = [];
  let failed = false;
  if (databaseConfigured) {
    try { endpoints = await db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt)); }
    catch { failed = true; }
  }
  const usable = databaseConfigured && !failed && Boolean(process.env.WEBHOOK_SECRET_KEY);

  return (
    <AppShell session={session}>
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-eyebrow mb-2">Developer platform</p>
          <h1 className="page-title">Webhooks</h1>
          <p className="page-description">Receive signed lifecycle and engagement events with retry-safe delivery to public HTTPS endpoints.</p>
        </div>
        <WebhookCreate disabled={!usable} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <article className="premium-panel overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Destinations</p><h2 className="mt-1 text-lg font-black">Webhook endpoints</h2></div>
          {endpoints.length ? <div className="divide-y divide-[var(--border)]">{endpoints.map((endpoint) => <div key={endpoint.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-black">{endpoint.name}</p><span className={`rounded-full px-2 py-1 text-[10px] font-black ${endpoint.active ? "bg-emerald-500/10 text-emerald-600" : "bg-zinc-500/10 text-zinc-500"}`}>{endpoint.active ? "Active" : "Disabled"}</span></div><p className="mt-1 truncate text-xs text-[var(--muted)]">{endpoint.url}</p></div><WebhookActions id={endpoint.id} active={endpoint.active} /></div>)}</div> : <div className="grid min-h-72 place-items-center p-8 text-center"><div className="max-w-md"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Webhook className="h-5 w-5" /></div><h3 className="mt-4 font-black">No webhook endpoints yet</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Add an HTTPS endpoint to receive signed NexiMail events.</p></div></div>}
        </article>

        <aside className="space-y-4">
          <article className="premium-panel p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /></div><div><h2 className="font-black">Signed requests</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Secrets are encrypted at rest. Deliveries carry <code>x-neximail-signature</code> with an HMAC-SHA256 signature.</p></div></div></article>
          <article className="premium-panel p-5 sm:p-6"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300"><RefreshCw className="h-5 w-5" /></div><div><h2 className="font-black">Automatic retries</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Non-2xx and network failures retry with exponential backoff and a terminal failed state.</p></div></div></article>
        </aside>
      </section>

      <section className="premium-panel mt-5 p-5 sm:p-6">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Activity className="h-5 w-5" /></div><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Event catalog</p><h2 className="mt-1 font-black">Active lifecycle signals</h2></div></div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{events.map((event) => <div key={event} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-3"><BadgeCheck className="h-4 w-4 text-emerald-500" /><code className="text-xs font-bold">{event}</code></div>)}</div>
      </section>
    </AppShell>
  );
}
