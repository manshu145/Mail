import { Activity, CheckCircle2, CircleAlert, ServerCog } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { databaseConfigured, db, pool } from "@/db";
import { workerHeartbeats } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";
import { getRedis, isRedisConfigured } from "@/lib/redis";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let postgres: "online" | "offline" | "not_configured" = databaseConfigured ? "offline" : "not_configured";
  let redis: "online" | "offline" | "not_configured" = isRedisConfigured() ? "offline" : "not_configured";
  if (databaseConfigured) { try { await pool.query("select 1"); postgres = "online"; } catch {} }
  if (isRedisConfigured()) { try { const client = getRedis(); if (client.status === "wait") await client.connect(); redis = (await client.ping()) === "PONG" ? "online" : "offline"; } catch {} }

  let beats: typeof workerHeartbeats.$inferSelect[] = [];
  if (databaseConfigured) { try { beats = await db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastSeenAt)); } catch {} }
  const beat = new Map(beats.map((item) => [item.workerName, item]));
  const workerState = (name: string) => { const item = beat.get(name); if (!item) return "not_configured" as const; return Date.now() - item.lastSeenAt.getTime() < 12 * 60 * 1000 ? "online" as const : "offline" as const; };

  const workerNames = ["import", "campaign", "policy", "transport", "event", "validation", "reputation", "domain-health", "dkim", "webhook", "postfix-events"];
  const items = [
    { name: "Application", status: "online", detail: "NexiMail control plane", icon: Activity },
    { name: "PostgreSQL", status: postgres, detail: "Persistent application data", icon: ServerCog },
    { name: "Redis", status: redis, detail: "Rate limits and queue coordination", icon: ServerCog },
    ...workerNames.map((name) => ({ name: `${name.replaceAll("-", " ")} worker`, status: workerState(name), detail: beat.get(name) ? `Last heartbeat ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(beat.get(name)!.lastSeenAt)}` : "No heartbeat recorded", icon: ServerCog })),
  ];

  return <AppShell session={session}><div className="mb-7"><p className="page-eyebrow mb-2">Operations</p><h1 className="page-title">System health</h1><p className="page-description">Live runtime checks and persisted worker heartbeats. Stale workers are shown offline instead of being silently reported healthy.</p></div><section className="grid gap-4 lg:grid-cols-2">{items.map(({ name, status, detail, icon: Icon }) => { const online = status === "online"; const bad = status === "offline"; return <article key={name} className="premium-panel p-5"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-4"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]"><Icon className="h-5 w-5" /></div><div><h2 className="font-black capitalize">{name}</h2><p className="mt-1 text-sm text-[var(--muted)]">{detail}</p></div></div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${online ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : bad ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-[var(--surface-soft)] text-[var(--muted)]"}`}>{online ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}{status.replaceAll("_", " ")}</span></div></article>; })}</section></AppShell>;
}
