"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CampaignAttachments } from "@/components/campaign-attachments";

type Option = { id: string; name: string };
type AccountOption = Option & { fromName: string; fromEmail: string; replyTo: string | null };
type Campaign = { id: string; name: string; subject: string; preheader: string | null; fromName: string | null; fromEmail: string | null; listId: string | null; templateId: string | null; sendingAccountId: string | null; trackOpens: boolean; trackClicks: boolean; scheduledAt: string | null; status: string };
type RuntimePolicyView = { mode: "staging" | "production"; sendingEnabled: boolean; maxRecipientsPerCampaign: number | null };
type CampaignAction = "save" | "send_now" | "schedule";

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
  const [notice, setNotice] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [showTest, setShowTest] = useState(false);
  const [listId, setListId] = useState(campaign.listId || "");
  const [templateId, setTemplateId] = useState(campaign.templateId || "");
  const [accountId, setAccountId] = useState(campaign.sendingAccountId || "");
  const selectedAccount = useMemo(() => accounts.find((x) => x.id === accountId) || null, [accounts, accountId]);
  const initialAccount = accounts.find((x) => x.id === campaign.sendingAccountId) || null;
  const campaignOverrideAllowed = Boolean(campaign.fromEmail && initialAccount && domainOf(campaign.fromEmail) === domainOf(initialAccount.fromEmail));
  const [fromName, setFromName] = useState(campaign.fromName || initialAccount?.fromName || "");
  const [fromEmail, setFromEmail] = useState(campaignOverrideAllowed ? campaign.fromEmail! : initialAccount?.fromEmail || "");
  const [schedule, setSchedule] = useState(toLocalDateTimeInput(campaign.scheduledAt));
  const deliveryReady = Boolean(listId && templateId && accountId && runtimePolicy.sendingEnabled);
  const testReady = Boolean(templateId && accountId && runtimePolicy.sendingEnabled);

  function chooseAccount(id: string) {
    setAccountId(id);
    const next = accounts.find((x) => x.id === id);
    if (next) { setFromName(next.fromName); setFromEmail(next.fromEmail); }
  }

  function payload(formData: FormData, action: CampaignAction) {
    return {
      name: formData.get("name"), subject: formData.get("subject"), preheader: formData.get("preheader"),
      fromName: formData.get("fromName"), fromEmail: formData.get("fromEmail"), listId: formData.get("listId"),
      templateId: formData.get("templateId"), sendingAccountId: formData.get("sendingAccountId"), scheduledAt: action === "send_now" ? null : scheduledValue(formData),
      trackOpens: formData.get("trackOpens") === "on", trackClicks: formData.get("trackClicks") === "on", action,
    };
  }

  async function submit(formData: FormData, action: CampaignAction) {
    setError(""); setNotice("");
    if (action !== "save" && !deliveryReady) {
      setError("Select an audience list, template and active sending account before delivery.");
      return;
    }
    if (action === "schedule") {
      const raw = scheduledValue(formData);
      if (!raw || new Date(raw).getTime() <= Date.now()) {
        setError("Choose a future date and time before scheduling.");
        return;
      }
    }
    if (action === "send_now" && !window.confirm("Queue this campaign for immediate delivery to the currently eligible audience?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(formData, action)) });
      const data = await response.json().catch(() => ({})) as { error?: string; status?: string; audienceSize?: number };
      if (!response.ok) { setError(data.error || "Could not update campaign."); return; }
      setNotice(action === "save" ? "Draft saved." : action === "schedule" ? `Campaign scheduled${data.audienceSize ? ` for ${data.audienceSize.toLocaleString()} recipients` : ""}.` : `Campaign queued to send now${data.audienceSize ? ` to ${data.audienceSize.toLocaleString()} recipients` : ""}.`);
      router.refresh();
    } catch {
      setError("Could not confirm the campaign update. Check connectivity and refresh before retrying.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(form: HTMLFormElement) {
    setError(""); setNotice("");
    if (!testRecipient.trim()) { setError("Enter a test recipient email."); return; }
    if (!testReady) { setError("Select a template and active sending account before sending a test."); return; }
    setBusy(true);
    try {
      const fd = new FormData(form);
      const body = { ...payload(fd, "save"), recipient: testRecipient.trim(), action: undefined };
      const response = await fetch(`/api/campaigns/${campaign.id}/test-send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { error?: string; queueId?: string; attachments?: number };
      if (!response.ok) { setError(data.error || "Test send failed."); return; }
      setNotice(`Test email accepted by MTA${data.queueId ? ` · Queue ${data.queueId}` : ""}${data.attachments ? ` · ${data.attachments} attachment${data.attachments === 1 ? "" : "s"}` : ""}.`);
      setShowTest(false);
    } catch {
      setError("Could not confirm the test send. Check connectivity before retrying.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="space-y-5" action={async (formData) => submit(formData, "save")}>
    <div className="grid gap-4 lg:grid-cols-2">
      <label><span className="mb-1.5 block text-sm font-bold">Internal name</span><input name="name" defaultValue={campaign.name} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label>
      <label><span className="mb-1.5 block text-sm font-bold">Subject</span><input name="subject" defaultValue={campaign.subject} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label>
    </div>
    <label><span className="mb-1.5 block text-sm font-bold">Preheader</span><input name="preheader" defaultValue={campaign.preheader || ""} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" /></label>

    <div className="grid gap-4 lg:grid-cols-3">
      <label><span className="mb-1.5 block text-sm font-bold">Audience list</span><select name="listId" value={listId} onChange={(e)=>setListId(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select list</option>{lists.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="mb-1.5 block text-sm font-bold">Template</span><select name="templateId" value={templateId} onChange={(e)=>setTemplateId(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select template</option>{templates.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="mb-1.5 block text-sm font-bold">Sending account</span><select name="sendingAccountId" value={accountId} onChange={(e)=>chooseAccount(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select account</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    </div>

    <div className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${deliveryReady ? "border-emerald-500/15 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-300" : "border-amber-500/15 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200"}`}>
      {deliveryReady ? "Delivery setup is complete. Final audience eligibility and sending-domain health are rechecked when you send." : "Delivery setup incomplete: choose an audience list, template and active sending account."}
    </div>

    <CampaignAttachments campaignId={campaign.id} />

    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-extrabold">Sender</p><p className="mt-0.5 text-xs text-[var(--muted)]">Uses the selected verified sending identity.</p></div>{selectedAccount ? <button type="button" className="btn-secondary" onClick={()=>{setFromName(selectedAccount.fromName);setFromEmail(selectedAccount.fromEmail)}}>Use identity defaults</button> : null}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <label><span className="mb-1.5 block text-sm font-bold">From name</span><input name="fromName" value={fromName} onChange={(e)=>setFromName(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm" /></label>
        <label><span className="mb-1.5 block text-sm font-bold">From email</span><input name="fromEmail" type="email" value={fromEmail} onChange={(e)=>setFromEmail(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm" /></label>
        <label><span className="mb-1.5 block text-sm font-bold">Schedule for later</span><input name="scheduledAt" type="datetime-local" value={schedule} onChange={(e)=>setSchedule(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm" /></label>
      </div>
      {selectedAccount ? <p className="mt-3 text-xs text-[var(--muted)]">Identity: {selectedAccount.fromName} &lt;{selectedAccount.fromEmail}&gt;{selectedAccount.replyTo ? ` · Reply-to: ${selectedAccount.replyTo}` : ""}</p> : null}
    </div>

    <div className="flex flex-wrap gap-5 rounded-2xl bg-[var(--surface-soft)] p-4 text-sm font-bold"><label className="flex items-center gap-2"><input type="checkbox" name="trackOpens" defaultChecked={campaign.trackOpens} /> Track opens</label><label className="flex items-center gap-2"><input type="checkbox" name="trackClicks" defaultChecked={campaign.trackClicks} /> Track clicks</label></div>
    <p className="text-xs text-[var(--muted)]">NexiMail automatically adds a visible unsubscribe link and one-click unsubscribe headers at send time.</p>

    {showTest ? <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex-1"><span className="mb-1.5 block text-sm font-bold">Test recipient</span><input type="email" value={testRecipient} onChange={(e)=>setTestRecipient(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm outline-none" /></label><button type="button" disabled={busy || !testReady} onClick={(event)=>{const form=event.currentTarget.form;if(form)sendTest(form)}} className="btn-primary">{busy ? "Sending…" : "Send test"}</button><button type="button" onClick={()=>setShowTest(false)} className="btn-secondary">Cancel</button></div><p className="mt-2 text-[11px] text-[var(--muted)]">This sends one real message through the configured MTA, including campaign attachments, but does not add the address to your audience or campaign queue.</p></div> : null}

    {error ? <p role="alert" aria-live="polite" className="rounded-xl border border-rose-500/15 bg-rose-500/[0.06] px-3.5 py-3 text-sm font-semibold text-rose-600">{error}</p> : null}
    {notice ? <p role="status" aria-live="polite" className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-3.5 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{notice}</p> : null}

    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap gap-2"><button disabled={busy} className="btn-secondary" type="submit">Save draft</button><button disabled={busy || !testReady} className="btn-secondary" type="button" onClick={()=>setShowTest(true)}>Send test</button></div>
      <div className="flex flex-wrap gap-2"><button disabled={busy || !deliveryReady || !schedule} className="btn-secondary" type="button" onClick={(event)=>{const form=event.currentTarget.form;if(form)submit(new FormData(form),"schedule")}}>Schedule</button><button disabled={busy || !deliveryReady} className="btn-primary" type="button" onClick={(event)=>{const form=event.currentTarget.form;if(form)submit(new FormData(form),"send_now")}}>{busy ? "Working…" : "Send now"}</button></div>
    </div>
  </form>;
}
