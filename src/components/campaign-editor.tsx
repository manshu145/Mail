"use client";

import { Eye, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CampaignAttachments } from "@/components/campaign-attachments";

type Option = { id: string; name: string };
type AccountOption = Option & { fromName: string; fromEmail: string; replyTo: string | null };
type Campaign = { id: string; name: string; subject: string; preheader: string | null; fromName: string | null; fromEmail: string | null; listId: string | null; templateId: string | null; sendingAccountId: string | null; trackOpens: boolean; trackClicks: boolean; scheduledAt: string | null; status: string };
type RuntimePolicyView = { mode: "staging" | "production"; sendingEnabled: boolean; maxRecipientsPerCampaign: number | null };
type CampaignAction = "save" | "send_now" | "schedule";
type PreviewData = {
  audience: { rawCount:number; eligibleCount:number; suppressedCount:number; invalidCount:number; validCount:number; pendingCount:number; unknownCount:number; awaitingValidationCount:number };
  template: { name:string; subject:string|null; html:string; text:string };
};

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
export function CampaignEditor({ campaign, lists, templates, accounts, runtimePolicy }: { campaign: Campaign; lists: Option[]; templates: Option[]; accounts: AccountOption[]; runtimePolicy: RuntimePolicyView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [showTest, setShowTest] = useState(false);
  const [listId, setListId] = useState(campaign.listId || "");
  const [templateId, setTemplateId] = useState(campaign.templateId || "");
  const [accountId, setAccountId] = useState(campaign.sendingAccountId || "");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop"|"mobile">("desktop");
  const selectedAccount = useMemo(() => accounts.find((x) => x.id === accountId) || null, [accounts, accountId]);
  const initialAccount = accounts.find((x) => x.id === campaign.sendingAccountId) || null;
  const [fromName, setFromName] = useState(initialAccount?.fromName || "");
  const [fromEmail, setFromEmail] = useState(initialAccount?.fromEmail || "");
  const [schedule, setSchedule] = useState(toLocalDateTimeInput(campaign.scheduledAt));
  const deliveryReady = Boolean(listId && templateId && accountId && runtimePolicy.sendingEnabled);
  const reviewReady = Boolean(preview && preview.audience.eligibleCount > 0 && (runtimePolicy.maxRecipientsPerCampaign === null || preview.audience.eligibleCount <= runtimePolicy.maxRecipientsPerCampaign));
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

  async function loadPreview(silent = false) {
    if (!listId || !templateId) { setPreview(null); return; }
    setPreviewBusy(true);
    if (!silent) { setError(""); setNotice(""); }
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId, templateId }),
      });
      const data = await response.json().catch(() => ({})) as PreviewData & { error?: string };
      if (!response.ok) {
        if (!silent) setError(data.error || "Could not build campaign preview.");
        setPreview(null);
        return;
      }
      setPreview(data);
    } catch {
      if (!silent) setError("Could not refresh campaign preview.");
    } finally {
      setPreviewBusy(false);
    }
  }

  useEffect(() => {
    if (!listId || !templateId) { setPreview(null); return; }
    const timer = window.setTimeout(() => void loadPreview(true), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, templateId]);

  async function submit(formData: FormData, action: CampaignAction) {
    setError(""); setNotice("");
    if (action !== "save" && !deliveryReady) {
      setError("Select an audience list, template and active sending account before delivery.");
      return;
    }
    if (action !== "save" && !reviewReady) {
      setError("Review the latest template preview and final audience estimate before sending or scheduling.");
      return;
    }
    if (action === "schedule") {
      const raw = scheduledValue(formData);
      if (!raw || new Date(raw).getTime() <= Date.now()) {
        setError("Choose a future date and time before scheduling.");
        return;
      }
    }
    if (action === "send_now") {
      const eligible = preview?.audience.eligibleCount;
      const message = eligible === undefined
        ? "Queue this campaign for immediate delivery? NexiMail will run one final audience preflight before queueing."
        : `Send this campaign to approximately ${eligible.toLocaleString()} currently send-eligible recipients? NexiMail will recheck eligibility once more before queueing.`;
      if (!window.confirm(message)) return;
    }

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
      <label><span className="mb-1.5 block text-sm font-bold">Audience list</span><select name="listId" value={listId} onChange={(e)=>{setListId(e.target.value);setPreview(null)}} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select list</option>{lists.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="mb-1.5 block text-sm font-bold">Template</span><select name="templateId" value={templateId} onChange={(e)=>{setTemplateId(e.target.value);setPreview(null)}} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select template</option>{templates.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="mb-1.5 block text-sm font-bold">Sending identity</span><select name="sendingAccountId" value={accountId} onChange={(e)=>chooseAccount(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="">Select approved identity</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.name} — {x.fromName} &lt;{x.fromEmail}&gt;</option>)}</select></label>
    </div>

    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2"><Eye className="h-4 w-4 text-violet-600"/><p className="text-sm font-black">Review & preview</p></div><p className="mt-1 text-xs text-[var(--muted)]">Audience count updates from the same resolver used at send time. Final send runs one more preflight.</p></div>
        <button type="button" disabled={previewBusy || !listId || !templateId} onClick={()=>void loadPreview()} className="btn-secondary !min-h-9"><RefreshCw className={`h-3.5 w-3.5 ${previewBusy?"animate-spin":""}`}/> Refresh review</button>
      </div>

      {preview ? <div className="grid gap-px bg-[var(--border)] xl:grid-cols-[.72fr_1.28fr]">
        <div className="bg-[var(--surface)] p-4 sm:p-5">
          <p className="page-eyebrow">Final audience estimate</p>
          <p className="mt-2 text-4xl font-black tracking-[-.05em] text-emerald-600">{preview.audience.eligibleCount.toLocaleString()}</p>
          <p className="mt-1 text-xs font-bold text-[var(--muted)]">currently eligible recipients</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {[
              ["Matched",preview.audience.rawCount,"violet"],
              ["Valid",preview.audience.validCount,"emerald"],
              ["Pending",preview.audience.pendingCount,"amber"],
              ["Gmail pending (optional)",preview.audience.awaitingValidationCount,"amber"],
              ["Unknown",preview.audience.unknownCount,"orange"],
              ["Suppressed",preview.audience.suppressedCount,"rose"],
              ["Invalid",preview.audience.invalidCount,"rose"],
            ].map(([label,count,tone])=><div key={String(label)} className={`rounded-xl border p-3 ${tone==="emerald"?"border-emerald-500/15 bg-emerald-500/[0.05]":tone==="amber"?"border-amber-500/15 bg-amber-500/[0.05]":tone==="orange"?"border-orange-500/15 bg-orange-500/[0.05]":tone==="rose"?"border-rose-500/15 bg-rose-500/[0.05]":"border-violet-500/15 bg-violet-500/[0.05]"}`}><div className="font-black">{Number(count).toLocaleString()}</div><div className="mt-0.5 text-[10px] font-bold text-[var(--muted)]">{label}</div></div>)}
          </div>
          {runtimePolicy.maxRecipientsPerCampaign!==null && preview.audience.eligibleCount>runtimePolicy.maxRecipientsPerCampaign ? <p className="mt-4 rounded-xl bg-rose-500/10 p-3 text-xs font-bold text-rose-700 dark:text-rose-300">Audience exceeds the runtime limit of {runtimePolicy.maxRecipientsPerCampaign.toLocaleString()} recipients.</p> : null}
        </div>
        <div className="bg-[#e9edf5] p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[.12em] text-zinc-500">Template preview</p><p className="mt-1 truncate text-xs font-bold text-zinc-700">{preview.template.name}{preview.template.subject ? ` · ${preview.template.subject}` : ""}</p></div>
            <div className="flex rounded-xl border border-zinc-300 bg-white p-1">
              <button type="button" aria-label="Desktop campaign preview" onClick={()=>setPreviewMode("desktop")} className={`rounded-lg p-2 ${previewMode==="desktop"?"bg-violet-500/10 text-violet-600":"text-zinc-500"}`}><Monitor className="h-4 w-4"/></button>
              <button type="button" aria-label="Mobile campaign preview" onClick={()=>setPreviewMode("mobile")} className={`rounded-lg p-2 ${previewMode==="mobile"?"bg-violet-500/10 text-violet-600":"text-zinc-500"}`}><Smartphone className="h-4 w-4"/></button>
            </div>
          </div>
          <div className={`mx-auto overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm transition-all ${previewMode==="mobile"?"max-w-[390px]":"max-w-[760px]"}`}>
            {preview.template.html ? <iframe title="Campaign email preview" sandbox="" srcDoc={preview.template.html} className="h-[520px] w-full bg-white"/> : <pre className="h-[520px] overflow-auto whitespace-pre-wrap p-5 text-sm text-zinc-800">{preview.template.text || "Template has no content."}</pre>}
          </div>
        </div>
      </div> : <div className="p-6 text-center text-sm text-[var(--muted)]">{listId&&templateId ? (previewBusy ? "Calculating audience and rendering template…" : "Preview unavailable. Refresh review.") : "Choose an audience list and template to see the final recipient estimate and email preview."}</div>}
    </section>

    <div className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${deliveryReady ? "border-emerald-500/15 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-300" : "border-amber-500/15 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200"}`}>
      {deliveryReady ? (reviewReady ? "Review complete. Audience, domain health and policy are rechecked again when you send." : "Delivery setup is complete. Wait for the latest Review & preview before sending.") : "Delivery setup incomplete: choose an audience list, template and active sending account."}
    </div>

    <CampaignAttachments campaignId={campaign.id} />

    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
      <div className="mb-3"><p className="text-sm font-extrabold">Sender</p><p className="mt-0.5 text-xs text-[var(--muted)]">From email is locked to the approved sending identity selected above.</p></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <label><span className="mb-1.5 block text-sm font-bold">From name</span><div className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm font-bold text-[var(--foreground)]">{fromName || "Select a sending identity"}</div><input type="hidden" name="fromName" value={fromName} /></label>
        <label><span className="mb-1.5 block text-sm font-bold">From email</span><div className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm font-bold text-[var(--foreground)]">{fromEmail || "Select a sending identity"}</div><input type="hidden" name="fromEmail" value={fromEmail} /></label>
        <label><span className="mb-1.5 block text-sm font-bold">Schedule for later</span><input name="scheduledAt" type="datetime-local" value={schedule} onChange={(e)=>setSchedule(e.target.value)} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm" /></label>
      </div>
      {selectedAccount ? <p className="mt-3 text-xs text-[var(--muted)]">Identity: {selectedAccount.fromName} &lt;{selectedAccount.fromEmail}&gt;{selectedAccount.replyTo ? ` · Reply-to: ${selectedAccount.replyTo}` : ""}</p> : null}
    </div>

    <div className="flex flex-wrap gap-5 rounded-2xl bg-[var(--surface-soft)] p-4 text-sm font-bold"><label className="flex items-center gap-2"><input type="checkbox" name="trackOpens" defaultChecked={campaign.trackOpens} /> Track opens</label><label className="flex items-center gap-2"><input type="checkbox" name="trackClicks" defaultChecked={campaign.trackClicks} /> Track clicks</label></div>
    <p className="text-xs text-[var(--muted)]">NexiMail automatically adds a visible unsubscribe link and one-click unsubscribe headers at send time.</p>

    {showTest ? <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex-1"><span className="mb-1.5 block text-sm font-bold">Test recipient</span><input type="email" value={testRecipient} onChange={(e)=>setTestRecipient(e.target.value)} placeholder="you@example.com" className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-sm outline-none" /></label><button type="button" disabled={busy || !testReady} onClick={(event)=>{const form=event.currentTarget.form;if(form)void sendTest(form)}} className="btn-primary">{busy ? "Sending…" : "Send test"}</button><button type="button" onClick={()=>setShowTest(false)} className="btn-secondary">Cancel</button></div><p className="mt-2 text-[11px] text-[var(--muted)]">One real message through the configured MTA, with the same template and attachments, without joining the campaign audience.</p></div> : null}

    {error ? <p role="alert" aria-live="polite" className="rounded-xl border border-rose-500/15 bg-rose-500/[0.06] px-3.5 py-3 text-sm font-semibold text-rose-600">{error}</p> : null}
    {notice ? <p role="status" aria-live="polite" className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-3.5 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{notice}</p> : null}

    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap gap-2"><button disabled={busy} className="btn-secondary" type="submit">Save draft</button><button disabled={busy || !testReady} className="btn-secondary" type="button" onClick={()=>setShowTest(true)}>Send test</button></div>
      <div className="flex flex-wrap gap-2"><button disabled={busy || !deliveryReady || !reviewReady || !schedule} className="btn-secondary" type="button" onClick={(event)=>{const form=event.currentTarget.form;if(form)void submit(new FormData(form),"schedule")}}>Schedule</button><button disabled={busy || !deliveryReady || !reviewReady} className="btn-primary" type="button" onClick={(event)=>{const form=event.currentTarget.form;if(form)void submit(new FormData(form),"send_now")}}>{busy ? "Working…" : preview ? `Send to ~${preview.audience.eligibleCount.toLocaleString()}` : "Send now"}</button></div>
    </div>
  </form>;
}
