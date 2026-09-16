import { CheckCircle2, CircleAlert, FlaskConical, LockKeyhole, Send } from "lucide-react";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { contacts, lists, sendingAccounts, templates } from "@/db/schema";
import { sendingDomains } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";
import { isRedisConfigured } from "@/lib/redis";
import { getRuntimePolicy } from "@/lib/runtime-policy";

export default async function TestCenterPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const policy = getRuntimePolicy();
  let activeContacts = 0;
  let listCount = 0;
  let templateCount = 0;
  let activeSenders = 0;
  let readyDomains = 0;
  let dbHealthy = false;

  if (databaseConfigured) {
    try {
      const [contactRows, listRows, templateRows, senderRows, domainRows] = await Promise.all([
        db.select({ value: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.status, "active")),
        db.select({ value: sql<number>`count(*)::int` }).from(lists),
        db.select({ value: sql<number>`count(*)::int` }).from(templates),
        db.select({ value: sql<number>`count(*)::int` }).from(sendingAccounts).where(eq(sendingAccounts.status, "active")),
        db.select({ value: sql<number>`count(*)::int` }).from(sendingDomains).where(eq(sendingDomains.status, "ready")),
      ]);
      activeContacts = contactRows[0]?.value ?? 0;
      listCount = listRows[0]?.value ?? 0;
      templateCount = templateRows[0]?.value ?? 0;
      activeSenders = senderRows[0]?.value ?? 0;
      readyDomains = domainRows[0]?.value ?? 0;
      dbHealthy = true;
    } catch {
      dbHealthy = false;
    }
  }

  const checks = [
    { label: "Isolated runtime", ok: policy.isolated, detail: policy.isolated ? "Staging mode is active" : "Production mode is active" },
    { label: "PostgreSQL", ok: dbHealthy, detail: dbHealthy ? "Staging database reachable" : databaseConfigured ? "Configured but unavailable" : "Not connected" },
    { label: "Redis", ok: isRedisConfigured(), detail: isRedisConfigured() ? "Queue coordination configured" : "Not connected" },
    { label: "Sending gate", ok: policy.sendingEnabled, detail: policy.sendingEnabled ? "Controlled test sends enabled" : "Locked until explicit staging enable" },
    { label: "Ready sending domain", ok: readyDomains > 0, detail: `${readyDomains} domain${readyDomains === 1 ? "" : "s"} ready` },
    { label: "Active sender identity", ok: activeSenders > 0, detail: `${activeSenders} active sender${activeSenders === 1 ? "" : "s"}` },
    { label: "Audience list", ok: listCount > 0, detail: `${listCount} list${listCount === 1 ? "" : "s"} available` },
    { label: "Email template", ok: templateCount > 0, detail: `${templateCount} template${templateCount === 1 ? "" : "s"} available` },
  ];

  const ready = checks.every((item) => item.ok);

  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="page-eyebrow">Staging validation</p><h1 className="page-title mt-2">Test center</h1><p className="page-description">Pre-flight checks for the isolated 2,000–5,000 email validation run. Existing production NexiMail remains outside this environment.</p></div>
      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-black ${ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{ready ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}{ready ? "Ready for controlled test" : "Pre-flight incomplete"}</div>
    </div>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article className="metric-card p-5"><p className="text-xs font-extrabold text-[var(--muted)]">Active contacts</p><p className="mt-3 text-3xl font-black">{activeContacts.toLocaleString()}</p><p className="mt-2 text-xs text-[var(--muted)]">Staging database only</p></article>
      <article className="metric-card p-5"><p className="text-xs font-extrabold text-[var(--muted)]">Per-campaign cap</p><p className="mt-3 text-3xl font-black">{policy.maxRecipientsPerCampaign?.toLocaleString() ?? "∞"}</p><p className="mt-2 text-xs text-[var(--muted)]">Hard safety ceiling in staging</p></article>
      <article className="metric-card p-5"><p className="text-xs font-extrabold text-[var(--muted)]">Ready domains</p><p className="mt-3 text-3xl font-black">{readyDomains}</p><p className="mt-2 text-xs text-[var(--muted)]">SPF / DKIM / DMARC passed</p></article>
      <article className="metric-card p-5"><p className="text-xs font-extrabold text-[var(--muted)]">Active senders</p><p className="mt-3 text-3xl font-black">{activeSenders}</p><p className="mt-2 text-xs text-[var(--muted)]">Available to campaigns</p></article>
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] px-5 py-4"><div className="flex items-center gap-2"><FlaskConical className="h-4.5 w-4.5 text-violet-600" /><h2 className="font-black">Pre-flight checklist</h2></div></div><div className="divide-y divide-[var(--border)]">{checks.map((item) => <div key={item.label} className="flex items-center justify-between gap-4 px-5 py-4"><div className="flex min-w-0 items-center gap-3">{item.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <CircleAlert className="h-5 w-5 shrink-0 text-amber-500" />}<div><p className="text-sm font-extrabold">{item.label}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{item.detail}</p></div></div><span className={`text-[10px] font-black uppercase tracking-[.1em] ${item.ok ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>{item.ok ? "Pass" : "Pending"}</span></div>)}</div></article>
      <aside className="premium-panel p-5"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-600"><LockKeyhole className="h-5 w-5" /></div><h2 className="mt-4 text-lg font-black">Isolation contract</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">The current production panel is reference-only. This staging control plane must use its own database, Redis, configuration and test sending path until the validation run is signed off.</p><div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><div className="flex items-center gap-2"><Send className="h-4 w-4 text-violet-600" /><p className="text-xs font-black">Promotion rule</p></div><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Domain cutover and production wiring happen only after the controlled 2k–5k test is complete and stable.</p></div></aside>
    </section>
  </AppShell>;
}
