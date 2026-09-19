import { Inbox, MailSearch } from "lucide-react";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { InboxTestActions } from "@/components/inbox-test-actions";
import { SeedInboxActions } from "@/components/seed-inbox-actions";
import { db, databaseConfigured } from "@/db";
import { inboxTests, inboxTestResults, seedInboxes } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";

export default async function InboxPlacementPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let seeds: typeof seedInboxes.$inferSelect[] = [];
  let tests: typeof inboxTests.$inferSelect[] = [];
  let results: typeof inboxTestResults.$inferSelect[] = [];
  let bad = false;

  if (databaseConfigured) {
    try {
      [seeds, tests, results] = await Promise.all([
        db.select().from(seedInboxes).orderBy(desc(seedInboxes.createdAt)),
        db.select().from(inboxTests).orderBy(desc(inboxTests.createdAt)).limit(30),
        db.select().from(inboxTestResults).orderBy(desc(inboxTestResults.observedAt)).limit(200),
      ]);
    } catch {
      bad = true;
    }
  }

  const usable = databaseConfigured && !bad;
  const activeSeeds = seeds.filter((seed) => seed.active);
  const byTest = new Map<string, typeof results>();
  for (const result of results) byTest.set(result.testId, [...(byTest.get(result.testId) || []), result]);

  return <AppShell session={session}>
    <div className="mb-5">
      <p className="page-eyebrow mb-1.5">Deliverability</p>
      <h1 className="page-title">Inbox placement</h1>
      <p className="page-description">These are <b>seed-test placement</b> observations only—not guaranteed inbox percentages for your real audience. NexiMail records only results actually observed in configured seed inboxes.</p>
    </div>

    <div className="mb-5 grid gap-4 xl:grid-cols-2">
      <section className="premium-panel p-5">
        <div className="flex items-center justify-between">
          <div><h2 className="font-black">Seed inboxes</h2><p className="mt-1 text-sm text-zinc-500">Gmail / Outlook test mailboxes.</p></div>
          <ResourceCreate disabled={!usable || session.role !== "owner"} endpoint="/api/resources/seed-inboxes" title="Add seed inbox" buttonLabel="Add seed" fields={[{ name: "email", label: "Email", required: true }, { name: "provider", label: "Provider", type: "select", options: ["gmail", "outlook", "other"], required: true }, { name: "label", label: "Label" }]} />
        </div>
        <div className="mt-4 space-y-2">
          {seeds.map((seed) => <div key={seed.id} className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-bold">{seed.email}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${seed.active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-zinc-500/10 text-zinc-500"}`}>{seed.active ? "Active" : "Disabled"}</span>
              </div>
              <p className="mt-1 text-[12px] capitalize text-zinc-500">{seed.label ? `${seed.label} · ` : ""}{seed.provider}</p>
            </div>
            {session.role === "owner" ? <SeedInboxActions id={seed.id} active={seed.active} /> : null}
          </div>)}
          {!seeds.length ? <p className="py-8 text-center text-sm text-zinc-500">No seed inboxes configured.</p> : null}
        </div>
      </section>

      <section className="premium-panel p-5">
        <div className="flex items-center justify-between">
          <div><h2 className="font-black">New seed test</h2><p className="mt-1 text-sm text-zinc-500">Choose a campaign, send it to your seed inboxes, then let the seed agent report the observed folders.</p></div>
          <ResourceCreate disabled={!usable || !activeSeeds.length} endpoint="/api/resources/inbox-tests" title="Create seed test" buttonLabel="New test" fields={[{ name: "name", label: "Test name", required: true }, { name: "campaignId", label: "Campaign ID", placeholder: "Campaign UUID", required: true }]} />
        </div>
        <div className="mt-8 grid place-items-center text-center">
          <MailSearch className="h-9 w-9 text-zinc-400" />
          <p className="mt-3 text-sm leading-6 text-zinc-500">NexiMail sends the campaign to each active seed inbox. Placement is never guessed; the authenticated seed agent must report inbox, promotions, updates, spam or not found.</p>
        </div>
      </section>
    </div>

    <section className="premium-panel overflow-hidden">
      {tests.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-zinc-50 text-[11px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70">
            <tr><th className="px-4 py-3">Test</th><th>Status</th><th>Observed</th><th>Placement</th><th>Created</th><th className="px-5 py-3.5 text-right">Action</th></tr>
          </thead>
          <tbody>
            {tests.map((test) => {
              const rows = byTest.get(test.id) || [];
              const counts = rows.reduce<Record<string, number>>((acc, row) => (acc[row.category] = (acc[row.category] || 0) + 1, acc), {});
              return <tr key={test.id} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="px-4 py-3 font-black">{test.name}</td>
                <td className="capitalize font-bold">{test.status}</td>
                <td>{rows.length}</td>
                <td className="text-xs text-zinc-500">{Object.entries(counts).map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join(" · ") || "No observations yet"}</td>
                <td className="text-xs text-zinc-500">{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(test.createdAt)}</td>
                <td className="px-5 py-4 text-right"><InboxTestActions id={test.id} status={test.status} hasCampaign={Boolean(test.campaignId)} /></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <div className="grid min-h-64 place-items-center text-center"><div><Inbox className="mx-auto h-8 w-8 text-zinc-400"/><h2 className="mt-4 font-black">No seed tests yet</h2></div></div>}
    </section>
  </AppShell>;
}
