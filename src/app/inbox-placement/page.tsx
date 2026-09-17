import { Inbox, MailSearch } from "lucide-react";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { InboxTestActions } from "@/components/inbox-test-actions";
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
        db.select().from(seedInboxes).where(eq(seedInboxes.active, true)),
        db.select().from(inboxTests).orderBy(desc(inboxTests.createdAt)).limit(30),
        db.select().from(inboxTestResults).orderBy(desc(inboxTestResults.observedAt)).limit(200),
      ]);
    } catch {
      bad = true;
    }
  }

  const usable = databaseConfigured && !bad;
  const byTest = new Map<string, typeof results>();
  for (const result of results) byTest.set(result.testId, [...(byTest.get(result.testId) || []), result]);

  return <AppShell session={session}>
    <div className="mb-7">
      <p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Deliverability</p>
      <h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Inbox placement</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">These are <b>seed-test placement</b> observations only—not guaranteed inbox percentages for your real audience. NexiMail records only results actually observed in configured seed inboxes.</p>
    </div>

    <div className="mb-5 grid gap-4 lg:grid-cols-2">
      <section className="premium-panel p-5">
        <div className="flex items-center justify-between">
          <div><h2 className="font-black">Seed inboxes</h2><p className="mt-1 text-sm text-zinc-500">Gmail / Outlook test mailboxes.</p></div>
          <ResourceCreate disabled={!usable || session.role !== "owner"} endpoint="/api/resources/seed-inboxes" title="Add seed inbox" buttonLabel="Add seed" fields={[{ name: "email", label: "Email", required: true }, { name: "provider", label: "Provider", type: "select", options: ["gmail", "outlook", "other"], required: true }, { name: "label", label: "Label" }]} />
        </div>
        <div className="mt-4 space-y-2">
          {seeds.map((seed) => <div key={seed.id} className="flex justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><span className="text-sm font-bold">{seed.email}</span><span className="text-xs capitalize text-zinc-500">{seed.provider}</span></div>)}
          {!seeds.length ? <p className="py-8 text-center text-sm text-zinc-500">No seed inboxes configured.</p> : null}
        </div>
      </section>

      <section className="premium-panel p-5">
        <div className="flex items-center justify-between">
          <div><h2 className="font-black">New seed test</h2><p className="mt-1 text-sm text-zinc-500">Choose a campaign, send it to your seed inboxes, then let the seed agent report the observed folders.</p></div>
          <ResourceCreate disabled={!usable || !seeds.length} endpoint="/api/resources/inbox-tests" title="Create seed test" buttonLabel="New test" fields={[{ name: "name", label: "Test name", required: true }, { name: "campaignId", label: "Campaign ID", placeholder: "Campaign UUID", required: true }]} />
        </div>
        <div className="mt-8 grid place-items-center text-center">
          <MailSearch className="h-9 w-9 text-zinc-400" />
          <p className="mt-3 text-xs leading-5 text-zinc-500">NexiMail sends the campaign to each configured seed inbox. Placement is never guessed; the authenticated seed agent must report inbox, promotions, updates, spam or not found.</p>
        </div>
      </section>
    </div>

    <section className="premium-panel overflow-hidden">
      {tests.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-zinc-50 text-[11px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70">
            <tr><th className="px-5 py-3.5">Test</th><th>Status</th><th>Observed</th><th>Placement</th><th>Created</th><th className="px-5 py-3.5 text-right">Action</th></tr>
          </thead>
          <tbody>
            {tests.map((test) => {
              const rows = byTest.get(test.id) || [];
              const counts = rows.reduce<Record<string, number>>((acc, row) => (acc[row.category] = (acc[row.category] || 0) + 1, acc), {});
              return <tr key={test.id} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="px-5 py-4 font-black">{test.name}</td>
                <td className="capitalize font-bold">{test.status}</td>
                <td>{rows.length}/{seeds.length}</td>
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
