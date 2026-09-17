"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Option = { id: string; name: string };
type AccountOption = Option & { fromName: string; fromEmail: string; replyTo: string | null };
type Campaign = { id: string; name: string; subject: string; preheader: string | null; fromName: string | null; fromEmail: string | null; listId: string | null; templateId: string | null; sendingAccountId: string | null; trackOpens: boolean; trackClicks: boolean; scheduledAt: string | null; status: string };
type RuntimePolicyView = { mode: "staging" | "production"; sendingEnabled: boolean; maxRecipientsPerCampaign: number | null };

function toLocalDateTimeInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function scheduledValue(formData: FormData) {
  const raw = String(formData.get("scheduledAt") || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}
function domainOf(email: string | null | undefined) { return (email || "").split("@")[1]?.toLowerCase() || ""; }

export function CampaignEditor({ campaign, lists, templates, accounts, runtimePolicy }: { campaign: Campaign; lists: Option[]; templates: Option[]; accounts: AccountOption[]; runtimePolicy: RuntimePolicyView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState(campaign.sendingAccountId || "");
  const selectedAccount = useMemo(() => accounts.find((x) => x.id === accountId) || null, [accounts, accountId]);
  const initialAccount = accounts.find((x) => x.id === campaign.sendingAccountId) || null;
  const campaignOverrideAllowed = Boolean(campaign.fromEmail && initialAccount && domainOf(campaign.fromEmail) === domainOf(initialAccount.fromEmail));
  const [fromName, setFromName] = useState(campaign.fromName || initialAccount?.fromName || "");
  const [fromEmail, setFromEmail] = useState(campaignOverrideAllowed ? campaign.fromEmail! : initialAccount?.fromEmail || "");

  function chooseAccount(id: string) {
    setAccountId(id);
    const next = accounts.find((x) => x.id === id);
    if (next) { setFromName(next.fromName); setFromEmail(next.fromEmail); }
  }

  async function submit(formData: FormData, action: "save" | "queue") {
    setBusy(true); setError("");
    const body = {
      name: formData.get("name"), subject: formData.get("subject"), preheader: formData.get("preheader"),
      fromName: formData.get("fromName"), fromEmail: formData.get("fromEmail"), listId: formData.get("listId"),
      templateId: formData.get("templateId"), sendingAccountId: formData.get("sendingAccountId"), scheduledAt: scheduledValue(formData),
      trackOpens: formData.get("trackOpens") === "on", trackClicks: formData.get("trackClicks") === "on", action,
    };
    const response = await fetch(`/api/campaigns/${campaign.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error || "Could not update campaign."); return; }
    router.refresh();
  }

  return <form className="space-y-5" action={async (formData) => submit(formData, "save")}>
    <div className="grid gap-4 lg:grid-cols-2">
      <label><span className="mb-1.5 block text-sm font-bold">Internal name</span><input name="name" defaultValue={campaign.name} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label>
      <label><span className="mb-1.5 block text-sm font-bold">Subject</span><input name="subject" defaultValue={campaign.subject} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label>
    </div>
    <label><span className="mb-1.5 block text-sm font-bold">Preheader</span><input name="preheader" defaultValue={campaign.preheader || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label>
    <div className="grid gap-4 lg:grid-cols-3">
      <label><span className="mb-1.5 block text-sm font-bold">Audience list</span><select name="listId" defaultValue={campaign.listId || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select list</option>{lists.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="mb-1.5 block text-sm font-bold">Template</span><select name="templateId" defaultValue={campaign.templateId || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select template</option>{templates.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="mb-1.5 block text-sm font-bold">Sending account</span><select name="sendingAccountId" value={accountId} onChange={(e)=>chooseAccount(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select account</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    </div>
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-extrabold">Sender</p><p className="mt-0.5 text-xs text-[var(--muted)]">Uses the selected sender identity. Change only when you intentionally need another verified address on the same sending domain.</p></div>{selectedAccount ? <button type="button" className="btn-secondary" onClick={()=>{setFromName(selectedAccount.fromName);setFromEmail(selectedAccount.fromEmail)}}>Use identity defaults</button> : null}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <label><span className="mb-1.5 block text-sm font-bold">From name</span><input name="fromName" value={fromName} onChange={(e)=>setFromName(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm" /></label>
        <label><span className="mb-1.5 block text-sm font-bold">From email</span><input name="fromEmail" type="email" value={fromEmail} onChange={(e)=>setFromEmail(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm" /></label>
        <label><span className="mb-1.5 block text-sm font-bold">Schedule</span><input name="scheduledAt" type="datetime-local" defaultValue={toLocalDateTimeInput(campaign.scheduledAt)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm" /></label>
      </div>
      {selectedAccount ? <p className="mt-3 text-xs text-[var(--muted)]">Identity: {selectedAccount.fromName} &lt;{selectedAccount.fromEmail}&gt;{selectedAccount.replyTo ? ` · Reply-to: ${selectedAccount.replyTo}` : ""}</p> : null}
    </div>
    <div className="flex flex-wrap gap-5 rounded-2xl bg-[var(--surface-soft)] p-4 text-sm font-bold"><label className="flex items-center gap-2"><input type="checkbox" name="trackOpens" defaultChecked={campaign.trackOpens} /> Track opens</label><label className="flex items-center gap-2"><input type="checkbox" name="trackClicks" defaultChecked={campaign.trackClicks} /> Track clicks</label></div>
    <p className="text-xs text-[var(--muted)]">NexiMail automatically adds a visible unsubscribe link and one-click unsubscribe headers at send time.</p>
    {error ? <p className="rounded-xl border border-rose-500/15 bg-rose-500/[0.06] px-3.5 py-3 text-sm font-semibold text-rose-600">{error}</p> : null}
    <div className="flex flex-wrap justify-end gap-2"><button disabled={busy} className="btn-secondary" type="submit">Save draft</button><button disabled={busy || !runtimePolicy.sendingEnabled} className="btn-primary" type="button" onClick={(event)=>{const form=event.currentTarget.form;if(form) submit(new FormData(form),"queue");}}>Queue / schedule</button></div>
  </form>;
}
