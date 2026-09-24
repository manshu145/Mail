"use client";

import { useState } from "react";

type Seed = { id: string; email: string; provider: string; label: string | null; active: boolean };
type Campaign = { id: string; name: string; status: string; templateId: string | null; sendingAccountId: string | null };
type Test = { id: string; name: string; status: string; createdAt: string | Date; completedAt: string | Date | null; campaignId: string | null };
type Result = { id: string; testId: string; seedInboxId: string; category: string; detail: string | null; observedAt: string | Date };
type Props = { seeds: Seed[]; campaigns: Campaign[]; tests: Test[]; results: Result[] };

const categories = ["inbox", "promotions", "updates", "spam", "not_found"];

export function InboxTestsClient({ seeds: initialSeeds, campaigns, tests: initialTests, results: initialResults }: Props) {
  const [seeds, setSeeds] = useState(initialSeeds);
  const [tests, setTests] = useState(initialTests);
  const [results, setResults] = useState(initialResults);
  const [name, setName] = useState("");
  const [campaignId, setCampaignId] = useState(campaigns.find((campaign) => campaign.templateId && campaign.sendingAccountId)?.id || "");
  const [selectedSeeds, setSelectedSeeds] = useState<string[]>(initialSeeds.filter((seed) => seed.active).map((seed) => seed.id));
  const [seedEmail, setSeedEmail] = useState("");
  const [seedProvider, setSeedProvider] = useState("gmail");
  const [seedLabel, setSeedLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function createTest() {
    if (!name.trim() || !campaignId || !selectedSeeds.length) {
      setNotice("Enter a test name, choose a campaign and select at least one seed inbox.");
      return;
    }
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/inbox-tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, campaignId, seedInboxIds: selectedSeeds }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to create test.");
      const refresh = await fetch("/api/inbox-tests", { cache: "no-store" });
      const data = await refresh.json();
      setTests(data.tests || []);
      setResults(data.results || []);
      setName("");
      setNotice("Test campaign queued. After the seed messages arrive, record the folder placement below.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create test.");
    } finally { setBusy(false); }
  }

  async function addSeed() {
    if (!seedEmail.trim()) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/seed-inboxes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: seedEmail, provider: seedProvider, label: seedLabel }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to add seed.");
      setSeeds((current) => [payload.seed, ...current]);
      setSelectedSeeds((current) => [...current, payload.seed.id]);
      setSeedEmail(""); setSeedLabel("");
      setNotice("Seed inbox added.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to add seed.");
    } finally { setBusy(false); }
  }

  async function setPlacement(testId: string, seedInboxId: string, category: string) {
    const response = await fetch("/api/inbox-tests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testId, seedInboxId, category }) });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error || "Unable to save placement."); return; }
    setResults((current) => current.map((result) => result.testId === testId && result.seedInboxId === seedInboxId ? { ...result, category } : result));
    if (results.filter((result) => result.testId === testId).every((result) => result.category !== "not_found" || result.seedInboxId === seedInboxId)) {
      setTests((current) => current.map((test) => test.id === testId ? { ...test, status: "completed", completedAt: new Date() } : test));
    }
  }

  const completedResults = results.filter((result) => result.category !== "not_found");
  const placementRate = completedResults.length ? Math.round((completedResults.filter((result) => result.category === "inbox").length / completedResults.length) * 100) : 0;

  return <div className="space-y-5">
    {notice ? <div className="rounded-2xl border border-violet-500/15 bg-violet-500/[0.06] px-4 py-3 text-sm text-[var(--foreground)]">{notice}</div> : null}

    <section className="section-card p-5">
      <div className="mb-4"><p className="text-sm font-black">Run a placement test</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">NexiMail sends the selected campaign content through the normal campaign worker to the seed inboxes. Folder placement is recorded from the seed mailbox, not inferred from delivery logs.</p></div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly Gmail / Outlook check" className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-violet-500" />
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm">
          <option value="">Choose campaign content</option>
          {campaigns.filter((campaign) => campaign.templateId && campaign.sendingAccountId).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.status})</option>)}
        </select>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {seeds.filter((seed) => seed.active).map((seed) => <label key={seed.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-3 text-xs">
          <input type="checkbox" checked={selectedSeeds.includes(seed.id)} onChange={(e) => setSelectedSeeds((current) => e.target.checked ? [...current, seed.id] : current.filter((id) => id !== seed.id))} />
          <span><b>{seed.label || seed.provider}</b><span className="ml-2 text-[var(--muted)]">{seed.email}</span></span>
        </label>)}
      </div>
      <button disabled={busy} onClick={createTest} className="btn-primary mt-4">{busy ? "Working…" : "Run placement test"}</button>
    </section>

    <section className="section-card p-5">
      <div className="mb-4"><p className="text-sm font-black">Seed inboxes</p><p className="mt-1 text-xs text-[var(--muted)]">Use inboxes you control across the providers that matter to your audience.</p></div>
      <div className="grid gap-2 md:grid-cols-[1fr_160px_1fr_auto]">
        <input value={seedEmail} onChange={(e) => setSeedEmail(e.target.value)} placeholder="seed@gmail.com" className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm" />
        <select value={seedProvider} onChange={(e) => setSeedProvider(e.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm"><option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="other">Other</option></select>
        <input value={seedLabel} onChange={(e) => setSeedLabel(e.target.value)} placeholder="Label (optional)" className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm" />
        <button disabled={busy} onClick={addSeed} className="btn-secondary">Add seed</button>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-3">
      <article className="metric-card p-4"><p className="text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]">Tests</p><p className="mt-2 text-2xl font-black">{tests.length}</p></article>
      <article className="metric-card p-4"><p className="text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]">Inbox observations</p><p className="mt-2 text-2xl font-black">{completedResults.filter((result) => result.category === "inbox").length}</p></article>
      <article className="metric-card p-4"><p className="text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]">Measured inbox placement</p><p className="mt-2 text-2xl font-black">{placementRate}%</p></article>
    </section>

    <section className="section-card overflow-hidden">
      <div className="section-card-header"><div><p className="text-sm font-black">Placement history</p><p className="mt-1 text-xs text-[var(--muted)]">Seed results are a measured sample, not a guarantee of placement for the wider recipient list.</p></div></div>
      <div className="divide-y divide-[var(--border)]">
        {tests.length ? tests.map((test) => <div key={test.id} className="p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-black">{test.name}</p><p className="text-xs text-[var(--muted)]">{new Date(test.createdAt).toLocaleString("en-IN")} · {test.status}</p></div><span className="status-pill">{results.filter((result) => result.testId === test.id && result.category !== "not_found").length}/{results.filter((result) => result.testId === test.id).length} observed</span></div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {results.filter((result) => result.testId === test.id).map((result) => {
              const seed = seeds.find((item) => item.id === result.seedInboxId);
              return <div key={result.seedInboxId} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-black">{seed?.email || result.seedInboxId}</p><p className="text-[10px] text-[var(--muted)]">{seed?.provider || "seed"}</p></div>
                <select value={result.category} onChange={(e) => setPlacement(test.id, result.seedInboxId, e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs">
                  {categories.map((category) => <option key={category} value={category}>{category.replace("_"," ")}</option>)}
                </select></div>
              </div>;
            })}
          </div>
        </div>) : <div className="p-8 text-center text-sm text-[var(--muted)]">No placement tests yet.</div>}
      </div>
    </section>
  </div>;
}
