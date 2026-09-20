"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MousePointerClick, X } from "lucide-react";

type CampaignOption = { id: string; name: string };

export function EngagementSegmentCreate({ campaigns, disabled }: { campaigns: CampaignOption[]; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function preview(form: HTMLFormElement) {
    setPreviewBusy(true); setError(""); setPreviewCount(null);
    const data = new FormData(form);
    const params = new URLSearchParams({
      campaignId: String(data.get("campaignId") || ""),
      ruleType: String(data.get("ruleType") || ""),
    });
    const rawDays = String(data.get("windowDays") || "").trim();
    if (rawDays) params.set("windowDays", rawDays);
    const response = await fetch(`/api/segments/engagement?${params.toString()}`);
    const result = await response.json().catch(() => ({})) as { error?: string; members?: number };
    setPreviewBusy(false);
    if (!response.ok) { setError(result.error || "Could not preview audience."); return; }
    setPreviewCount(Number(result.members || 0));
  }

  async function create(formData: FormData) {
    setBusy(true); setError("");
    const rawDays = String(formData.get("windowDays") || "").trim();
    const response = await fetch("/api/segments/engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        description: formData.get("description"),
        campaignId: formData.get("campaignId"),
        ruleType: formData.get("ruleType"),
        mode: formData.get("mode"),
        windowDays: rawDays ? Number(rawDays) : null,
      }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string; members?: number | null };
    setBusy(false);
    if (!response.ok) { setError(data.error || "Could not create engagement audience."); return; }
    setOpen(false); setPreviewCount(null); router.refresh();
  }

  return <>
    <button disabled={disabled || !campaigns.length} onClick={() => setOpen(true)} className="btn-primary"><MousePointerClick className="h-4 w-4"/> Engagement audience</button>
    {open ? <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-4 backdrop-blur-sm sm:items-center sm:py-6"><section className="premium-panel max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto p-6"><div className="mb-5 flex items-start justify-between"><div><p className="page-eyebrow">Engagement segmentation</p><h2 className="mt-1 text-2xl font-black">Build from campaign activity</h2><p className="mt-1 text-xs text-[var(--muted)]">Create a live segment or freeze the current matching audience into a static list.</p></div><button className="icon-button" onClick={() => { setOpen(false); setPreviewCount(null); }}><X className="h-4 w-4"/></button></div><form action={create} className="space-y-4" ref={(form) => { if (form) (form as HTMLFormElement & { previewAudience?: () => void }).previewAudience = () => preview(form); }}>
      <label className="block"><span className="mb-1.5 block text-sm font-bold">Audience name</span><input name="name" required className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" placeholder="September campaign — Openers"/></label>
      <label className="block"><span className="mb-1.5 block text-sm font-bold">Campaign</span><select name="campaignId" required onChange={() => setPreviewCount(null)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm">{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-sm font-bold">Engagement rule</span><select name="ruleType" onChange={() => setPreviewCount(null)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="opened">Opened</option><option value="clicked">Clicked</option><option value="not_opened">Did not open</option><option value="not_clicked">Did not click</option><option value="delivered_not_opened">Delivered, not opened</option><option value="opened_not_clicked">Opened, not clicked</option></select></label><label><span className="mb-1.5 block text-sm font-bold">Audience type</span><select name="mode" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="dynamic">Dynamic segment</option><option value="static">Static list snapshot</option></select></label></div>
      <div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-sm font-bold">Optional activity window</span><input name="windowDays" type="number" min="1" max="3650" onChange={() => setPreviewCount(null)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" placeholder="e.g. 30 days"/></label><label><span className="mb-1.5 block text-sm font-bold">Description</span><input name="description" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" placeholder="High-intent follow-up audience"/></label></div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-xs leading-5 text-[var(--muted)]">Automated opens/clicks are excluded. Suppressed and invalid recipients are still removed by campaign preflight before sending.</div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><button type="button" disabled={previewBusy || busy} onClick={(event) => preview(event.currentTarget.form!)} className="btn-secondary flex-1">{previewBusy ? "Calculating…" : "Preview audience"}</button>{previewCount !== null ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-black text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">{previewCount.toLocaleString()} contacts</div> : null}</div>
      {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}<button disabled={busy} className="btn-primary w-full">{busy ? "Creating…" : "Create engagement audience"}</button>
    </form></section></div> : null}
  </>;
}
