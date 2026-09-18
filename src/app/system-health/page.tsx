import { Activity, CheckCircle2, CircleAlert, Database, MailCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { db, databaseConfigured, pool } from "@/db";
import { workerHeartbeats } from "@/db/operations-schema";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";
import { getRedis, isRedisConfigured } from "@/lib/redis";
import { EXPECTED_WORKERS, isWorkerHeartbeatFresh } from "@/lib/worker-health";

export const dynamic = "force-dynamic";

type HealthState = "operational" | "attention" | "unavailable";

export default async function SystemHealthPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let dataHealthy = false;
  let coordinationHealthy = false;

  if (databaseConfigured) {
    try {
      await pool.query("select 1");
      dataHealthy = true;
    } catch {}
  }

  if (isRedisConfigured()) {
    try {
      const client = getRedis();
      if (client.status === "wait") await client.connect();
      coordinationHealthy = (await client.ping()) === "PONG";
    } catch {}
  }

  let workerHealthy = 0;
  if (databaseConfigured) {
    try {
      const beats = await db.select().from(workerHeartbeats);
      const byName = new Map(beats.map((item) => [item.workerName, item.lastSeenAt]));
      workerHealthy = EXPECTED_WORKERS.filter((name) => isWorkerHeartbeatFresh(byName.get(name))).length;
    } catch {}
  }

  const backgroundState: HealthState =
    workerHealthy === EXPECTED_WORKERS.length ? "operational" :
    workerHealthy > 0 ? "attention" : "unavailable";

  const dataState: HealthState =
    dataHealthy && coordinationHealthy ? "operational" :
    dataHealthy || coordinationHealthy ? "attention" : "unavailable";

  const items: Array<{ name: string; status: HealthState; detail: string; icon: typeof Activity }> = [
    { name: "Application", status: "operational", detail: "NexiMail is available and responding normally.", icon: Activity },
    { name: "Data services", status: dataState, detail: dataState === "operational" ? "Core workspace data services are operating normally." : "A workspace data service needs attention.", icon: Database },
    { name: "Background processing", status: backgroundState, detail: backgroundState === "operational" ? "Background processing is operating normally." : "One or more background tasks need attention.", icon: Activity },
    { name: "Delivery services", status: backgroundState, detail: backgroundState === "operational" ? "Delivery processing services are available." : "Delivery processing requires attention before high-volume sending.", icon: MailCheck },
  ];

  return (
    <AppShell session={session}>
      <div className="mb-7">
        <p className="page-eyebrow mb-2">Operations</p>
        <h1 className="page-title">System health</h1>
        <p className="page-description">A privacy-safe overview of the services required to operate your NexiMail workspace.</p>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        {items.map(({ name, status, detail, icon: Icon }) => {
          const online = status === "operational";
          return (
            <article key={name} className="premium-panel p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-black">{name}</h2>
                    <p className="mt-1 text-sm text-[var(--muted)]">{detail}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${
                  online
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                }`}>
                  {online ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                  {status}
                </span>
              </div>
            </article>
          );
        })}
      </section>
    </AppShell>
  );
}
