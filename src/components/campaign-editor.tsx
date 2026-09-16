"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; name: string };
type Campaign = { id: string; name: string; subject: string; preheader: string | null; fromName: string | null; fromEmail: string | null; listId: string | null; templateId: string | null; sendingAccountId: string | null; trackOpens: boolean; trackClicks: boolean; scheduledAt: string | null; status: string };
type RuntimePolicyView = { mode: "staging" | "production"; sendingEnabled: boolean; maxRecipientsPerCampaign: number | null };

export function CampaignEditor({ campaign, lists, templates, accounts, runtimePolicy }: { campaign: Campaign; lists: Option[]; templates: Option[]; accounts: Option[]; runtimePolicy: RuntimePolicyView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(formData: FormData, action: "save" | "queue") {
    setBusy(true); setError("");
    const body = {
      name: formData.get("name"), subject: formData.get("subject"), preheader: formData.get("preheader"),
      fromName: formData.get("fromName"), fromEmail: formData.get("fromEmail"), listId: formData.get("listId"),
      templateId: formData.get("templateId"), sendingAccountId: formData.get("sendingAccountId"), scheduledAt: formData.get("scheduledAt"),
      trackOpens: formData.get("trackOpens") === "on", trackClicks: formData.get("trackClicks") === "on", action,
    };
    const response = await fetch(`/api/campaigns/${campaign.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error || "Could not update campaign."); return; }
    router.refresh();
  }

  return <form className="space-y-5" action={async (formData) => submit(formData, "save")}>
    <div className="grid gap-4 lg:grid-cols-2"><label><span className="mb-1.5 block text-sm font-bold">Internal name</span><input name="name" defaultValue={campaign.name} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label><label><span className="mb-1.5 block text-sm font-bold">Subject</span><input name="subject" defaultValue={campaign.subject} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label></div>
    <label><span className="mb-1.5 block text-sm font-bold">Preheader</span><input name="preheader" defaultValue={campaign.preheader || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label>
    <div className="grid gap-4 lg:grid-cols-3"><label><span className="mb-1.5 block text-sm font-bold">Audience list</span><select name="listId" defaultValue={campaign.listId || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select list</option>{lists.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><span className="mb-1.5 block text-sm font-bold">Template</span><select name="templateId" defaultValue={campaign.templateId || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select template</option>{templates.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><span className="mb-1.5 block text-sm font-bold">Sending account</span><select name="sendingAccountId" defaultValue={campaign.sendingAccountId || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select account</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div>
    <div className="grid gap-4 lg:grid-cols-3"><label><span className="mb-1.5 block text-sm font-bold">Override from name</span><input name="fromName" defaultValue={campaign.fromName || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" /></label><label><span className="mb-1.5 block text-sm font-bold">Override from email</span><input name="fromEmail" type="email" defaultValue={campaign.fromEmail || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" /></label><label><span className="mb-1.5 block text-sm font-bold">Schedule</span><input name="scheduledAt" type="datetime-local" defaultValue={campaign.scheduledAt ? campaign.scheduledAt.slice(0,16) : ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" /></label></div>
    <div className="flex flex-wrap gap-5 rounded-2xl bg-[var(--surface-soft)] p-4 text-sm font-bold"><label className="flex items-center gap-2"><input type="checkbox" name="trackOpens" defaultChecked={campaign.trackOpens} /> Track opens</label><label className="flex items-center gap-2"><input type="checkbox" name="trackClicks" defaultChecked={campaign.trackClicks} /> Track clicks</label></div>
    {error ? <p className="rounded-xl border border-rose-500/15 bg-rose-500/[0.06] px-3.5 py-3 text-sm font-semibold text-rose-600">{error}</p> : null}
    <div className="flex flex-wrap justify-end gap-2"><button disabled={busy} className="btn-secondary" type="submit">Save draft</button><button disabled={busy || !runtimePolicy.sendingEnabled} className="btn-primary" type="button" onClick={(event)=>{const form=event.currentTarget.form;if(form) submit(new FormData(form),"queue");}}>Queue / schedule</button></div>
  </form>;
}
