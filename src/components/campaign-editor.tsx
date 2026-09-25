"use client";

import { CheckCircle2, Circle, Eye, ListChecks, Maximize2, Monitor, RefreshCw, Rocket, Smartphone, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CampaignAttachments } from "@/components/campaign-attachments";

type Option = { id: string; name: string };
type AccountOption = Option & { fromName: string; fromEmail: string; replyTo: string | null };
type Campaign = { id: string; name: string; subject: string; preheader: string | null; fromName: string | null; fromEmail: string | null; listId: string | null; templateId: string | null; sendingAccountId: string | null; sendOnlyValidated: boolean; validationPolicy: string; trackOpens: boolean; trackClicks: boolean; scheduledAt: string | null; status: string };
type RuntimePolicyView = { mode: "staging" | "production"; sendingEnabled: boolean; maxRecipientsPerCampaign: number | null };
type CampaignAction = "save" | "send_now" | "schedule";
type PreviewData = {
  audience: { rawCount:number; eligibleCount:number; suppressedCount:number; invalidCount:number; validCount:number; pendingCount:number; unknownCount:number; awaitingValidationCount:number; domainInvalidCount:number; domainHealthPendingCount:number; checkedDomainCount:number };
  template: { name:string; subject:string|null; html:string; text:string };
  sendGuard: null | { status:"ready"|"warning"|"blocked"; checkedAt:string; blockingIssues:string[]; checks:Array<{key:string;label:string;status:"ready"|"warning"|"blocked";detail:string}> };
};

function toKolkataDateTimeInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 16);
}
function scheduledValue(formData: FormData) {
  const raw = String(formData.get("scheduledAt") || "").trim();
  if (!raw) return null;
  const date = new Date(`${raw}:00+05:30`);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function previewDocument(html: string) {
  const responsive = `<style id="neximail-preview-responsive">
    html,body{margin:0!important;width:100%!important;max-width:100%!important;overflow-x:hidden!important}
    body{box-sizing:border-box!important}
    body>table,body>div,body>center{max-width:100%!important}
    table{max-width:100%!important}
    img{max-width:100%!important;height:auto!important}
    pre{max-width:100%!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important}
    [style*="min-width"]{min-width:0!important}
    @media(max-width:480px){
      body{padding-left:0!important;padding-right:0!important}
      table[width]{width:100%!important}
      td,th{max-width:100%!important}
    }
  </style>`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1><meta name="viewport" content="width=device-width,initial-scale=1">${responsive}`);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${responsive}</head><body>${html}</body></html>`;
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
  const [sendOnlyValidated, setSendOnlyValidated] = useState(campaign.sendOnlyValidated);
  const [validationPolicy, setValidationPolicy] = useState<"standard"|"previously_validated"|"bypass_unvalidated">(campaign.validationPolicy === "previously_validated" ? "previously_validated" : campaign.validationPolicy === "bypass_unvalidated" ? "bypass_unvalidated" : "standard");
  const [validationAcknowledged, setValidationAcknowledged] = useState(false);
  const [subject, setSubject] = useState(campaign.subject);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop"|"mobile">("desktop");
  const [fullPreview, setFullPreview] = useState(false);
  const selectedAccount = useMemo(() => accounts.find((x) => x.id === accountId) || null, [accounts, accountId]);
  const initialAccount = accounts.find((x) => x.id === campaign.sendingAccountId) || null;
  const [fromName, setFromName] = useState(initialAccount?.fromName || "");
  const [fromEmail, setFromEmail] = useState(initialAccount?.fromEmail || "");
  const [schedule, setSchedule] = useState(toKolkataDateTimeInput(campaign.scheduledAt));
  const deliveryReady = Boolean(listId && templateId && accountId && runtimePolicy.sendingEnabled);
  const targetAudienceCount = sendOnlyValidated ? (preview?.audience.validCount ?? 0) : (preview?.audience.eligibleCount ?? 0);
  const requiresValidationAcknowledgement = !sendOnlyValidated && validationPolicy !== "standard";
  const reviewReady = Boolean(preview && preview.sendGuard && preview.sendGuard.status !== "blocked" && targetAudienceCount > 0 && (runtimePolicy.maxRecipientsPerCampaign === null || targetAudienceCount <= runtimePolicy.maxRecipientsPerCampaign));
  const testReady = Boolean(templateId && accountId && runtimePolicy.sendingEnabled);
  const readinessSteps=[
    {label:"Audience",ready:Boolean(listId)},
    {label:"Template",ready:Boolean(templateId)},
    {label:"Sender",ready:Boolean(accountId&&runtimePolicy.sendingEnabled)},
    {label:"Review",ready:reviewReady},
  ];
  const readyCount=readinessSteps.filter((step)=>step.ready).length;

  function chooseAccount(id: string) {
    setAccountId(id);
    const next = accounts.find((x) => x.id === id);
    if (next) { setFromName(next.fromName); setFromEmail(next.fromEmail); }
  }

  function payload(formData: FormData, action: CampaignAction) {
    return {
      name: formData.get("name"), subject: formData.get("subject"), preheader: formData.get("preheader"),
      fromName: formData.get("fromName"), fromEmail: formData.get("fromEmail"), listId: formData.get("listId"),
      templateId: formData.get("templateId"), sendingAccountId: formData.get("sendingAccountId"), validationPolicy: sendOnlyValidated ? "standard" : validationPolicy, validationAcknowledged: sendOnlyValidated ? false : validationAcknowledged, scheduledAt: action === "send_now" ? null : scheduledValue(formData),
      sendOnlyValidated: formData.get("sendOnlyValidated") === "on", trackOpens: formData.get("trackOpens") === "on", trackClicks: formData.get("trackClicks") === "on", action,
    };
  }

  async function loadPreview(silent = false) {
    if (!listId || !templateId || !accountId) { setPreview(null); return; }
    setPreviewBusy(true);
    if (!silent) { setError(""); setNotice(""); }
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId, templateId, sendingAccountId: accountId || null, subject, validationPolicy: sendOnlyValidated ? "standard" : validationPolicy }),
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
    const query = window.matchMedia("(max-width: 640px)");
    const sync = () => { if (query.matches) setPreviewMode("mobile"); };
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    if (!listId || !templateId || !accountId) { setPreview(null); return; }
    const timer = window.setTimeout(() => void loadPreview(true), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, templateId, accountId, subject, validationPolicy, sendOnlyValidated]);

  async function submit(formData: FormData, action: CampaignAction) {
    setError(""); setNotice("");
    if (action !== "save" && !deliveryReady) {
      setError("Select an audience list, template and active sending account before delivery.");
      return;
    }
    if (action !== "save" && requiresValidationAcknowledgement && !validationAcknowledged) {
      setError("Confirm the recipient-validation acknowledgement before sending without NexiMail validation.");
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

  return <form className="min-w-0 space-y-4 sm:space-y-5" action={async (formData) => submit(formData, "save")}>
    <section className="section-card overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-[var(--accent)]"><Rocket className="h-4.5 w-4.5"/></div><div><p className="page-eyebrow">Launch readiness</p><h3 className="mt-0.5 text-sm font-black">{readyCount} of 4 checks complete</h3></div></div>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Build the audience, content and sender setup, then review the final estimate before launch.</p>
        </div>
        <div className="min-w-0 lg:w-[46%]">
          <div className="progress-track"><div className="progress-fill" style={{width:`${readyCount/4*100}%`}}/></div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{readinessSteps.map((step)=><div key={step.label} className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[10px] font-black ${step.ready?"border-emerald-500/15 bg-emerald-500/[.06] text-emerald-700 dark:text-emerald-300":"border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"}`}>{step.ready?<CheckCircle2 className="h-3.5 w-3.5"/>:<Circle className="h-3.5 w-3.5"/>}{step.label}</div>)}</div>
        </div>
      </div>
    </section>

    <section className="section-card p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-[var(--accent)]"><ListChecks className="h-4 w-4"/></div><div><p className="text-sm font-black">Campaign setup</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Define the message, audience, template and approved sending identity.</p></div></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <label><span className="mb-1.5 block text-sm font-bold">Internal name</span><input name="name" defaultValue={campaign.name} required className="form-control" /></label>
      <label><span className="mb-1.5 block text-sm font-bold">Subject</span><input name="subject" value={subject} onChange={(event)=>setSubject(event.target.value)} required className="form-control" /></label>
    </div>
    <label><span className="mb-1.5 block text-sm font-bold">Preheader</span><input name="preheader" defaultValue={campaign.preheader || ""} className="form-control" /></label>

    <div className="grid gap-4 lg:grid-cols-3">
      <label><span className="mb-1.5 block text-sm font-bold">Audience list</span><select name="listId" value={listId} onChange={(e)=>{setListId(e.target.value);setPreview(null)}} className="form-control"><option value="">Select list</option>{lists.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="mb-1.5 block text-sm font-bold">Template</span><select name="templateId" value={templateId} onChange={(e)=>{setTemplateId(e.target.value);setPreview(null)}} className="form-control"><option value="">Select template</option>{templates.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span className="mb-1.5 block text-sm font-bold">Sending identity</span><select name="sendingAccountId" value={accountId} onChange={(e)=>chooseAccount(e.target.value)} className="form-control"><option value="">Select approved identity</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.name} — {x.fromName} &lt;{x.fromEmail}&gt;</option>)}</select></label>
    </div>
    </section>

    <section className="section-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2"><Eye className="h-4 w-4 text-violet-600"/><p className="text-sm font-black">Review & preview</p></div><p className="mt-1 text-xs text-[var(--muted)]">Audience count updates from the same resolver used at send time. Final send runs one more preflight.</p></div>
        <button type="button" disabled={previewBusy || !listId || !templateId || !accountId} onClick={()=>void loadPreview()} className="btn-secondary !min-h-9 w-full sm:w-auto"><RefreshCw className={`h-3.5 w-3.5 ${previewBusy?"animate-spin":""}`}/> Refresh review</button>
      </div>

      {preview ? <div className="grid min-w-0 gap-px bg-[var(--border)] xl:grid-cols-[.72fr_1.28fr]">
        <div className="min-w-0 bg-[var(--surface)] p-4 sm:p-5">
          <p className="page-eyebrow">Final audience estimate</p>
          <p className="mt-2 text-4xl font-black tracking-[-.05em] text-emerald-600">{preview.audience.eligibleCount.toLocaleString()}</p>
          <p className="mt-1 text-xs font-bold text-[var(--muted)]">currently eligible recipients</p>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 text-xs min-[360px]:grid-cols-2">
            {[
              ["Matched",preview.audience.rawCount,"violet"],
              ["Valid",preview.audience.validCount,"emerald"],
              ["Pending",preview.audience.pendingCount,"amber"],
              ["Gmail pending (optional)",preview.audience.awaitingValidationCount,"amber"],
              ["Unknown",preview.audience.unknownCount,"orange"],
              ["Suppressed",preview.audience.suppressedCount,"rose"],
              ["Address invalid",preview.audience.invalidCount,"rose"],
              ["Domain invalid",preview.audience.domainInvalidCount,"rose"],
              ["Domain DNS pending",preview.audience.domainHealthPendingCount,"amber"],
            ].map(([label,count,tone])=><div key={String(label)} className={`min-w-0 overflow-hidden rounded-xl border p-3 ${tone==="emerald"?"border-emerald-500/15 bg-emerald-500/[0.05]":tone==="amber"?"border-amber-500/15 bg-amber-500/[0.05]":tone==="orange"?"border-orange-500/15 bg-orange-500/[0.05]":tone==="rose"?"border-rose-500/15 bg-rose-500/[0.05]":"border-violet-500/15 bg-violet-500/[0.05]"}`}><div className="font-black">{Number(count).toLocaleString()}</div><div className="mt-0.5 break-words text-[11px] font-bold leading-4 text-[var(--muted)]">{label}</div></div>)}
          </div>
          {runtimePolicy.maxRecipientsPerCampaign!==null && preview.audience.eligibleCount>runtimePolicy.maxRecipientsPerCampaign ? <p className="mt-4 rounded-xl bg-rose-500/10 p-3 text-xs font-bold text-rose-700 dark:text-rose-300">Audience exceeds the runtime limit of {runtimePolicy.maxRecipientsPerCampaign.toLocaleString()} recipients.</p> : null}
          {preview.sendGuard ? <div className="mt-5 border-t border-[var(--border)] pt-4">
            <div className="flex items-center justify-between gap-3"><p className="page-eyebrow">Campaign preflight</p><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${preview.sendGuard.status==="ready"?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":preview.sendGuard.status==="warning"?"bg-amber-500/10 text-amber-700 dark:text-amber-300":"bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>{preview.sendGuard.status}</span></div>
            <div className="mt-3 space-y-2">{preview.sendGuard.checks.map((check)=><div key={check.key} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${check.status==="ready"?"bg-emerald-500":check.status==="warning"?"bg-amber-500":"bg-rose-500"}`}/><p className="text-xs font-black">{check.label}</p></div><p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">{check.detail}</p></div>)}</div>
          </div> : null}
        </div>
        <div className="min-w-0 overflow-hidden bg-[#e9edf5] p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="text-[11px] font-black uppercase tracking-[.12em] text-zinc-500">Template preview</p><p className="mt-1 line-clamp-2 break-words text-xs font-bold leading-5 text-zinc-700">{preview.template.name}{preview.template.subject ? ` · ${preview.template.subject}` : ""}</p></div>
            <div className="flex items-center gap-2 self-start sm:self-auto"><div className="flex rounded-xl border border-zinc-300 bg-white p-1">
              <button type="button" aria-label="Desktop campaign preview" onClick={()=>setPreviewMode("desktop")} className={`rounded-lg p-2 ${previewMode==="desktop"?"bg-violet-500/10 text-violet-600":"text-zinc-500"}`}><Monitor className="h-4 w-4"/></button>
              <button type="button" aria-label="Mobile campaign preview" onClick={()=>setPreviewMode("mobile")} className={`rounded-lg p-2 ${previewMode==="mobile"?"bg-violet-500/10 text-violet-600":"text-zinc-500"}`}><Smartphone className="h-4 w-4"/></button>
            </div><button type="button" aria-label="Open full preview" onClick={()=>setFullPreview(true)} className="grid h-9 w-9 place-items-center rounded-xl border border-zinc-300 bg-white text-zinc-600"><Maximize2 className="h-4 w-4"/></button></div>
          </div>
          <div className={`mx-auto w-full overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm transition-all ${previewMode==="mobile"?"max-w-[390px]":"max-w-[760px]"}`}>
            {preview.template.html ? <iframe title="Campaign email preview" sandbox="" srcDoc={previewDocument(preview.template.html)} className="h-[58dvh] min-h-[420px] w-full bg-white sm:h-[580px]"/> : <pre className="h-[58dvh] min-h-[420px] overflow-auto whitespace-pre-wrap p-4 text-sm text-zinc-800 sm:h-[580px] sm:p-5">{preview.template.text || "Template has no content."}</pre>}
          </div>
        </div>
      </div> : <div className="p-6 text-center text-sm text-[var(--muted)]">{listId&&templateId&&accountId ? (previewBusy ? "Running campaign preflight and rendering template…" : "Preview unavailable. Refresh review.") : "Choose an audience, template and sending identity to run campaign preflight."}</div>}
    </section>

    <div className={`rounded-2xl border px-4 py-3 text-xs font-semibold ${deliveryReady ? "border-emerald-500/15 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-300" : "border-amber-500/15 bg-amber-500/[0.06] text-amber-800 dark:text-amber-200"}`}>
      {deliveryReady ? (reviewReady ? `Preflight ${preview?.sendGuard?.status === "warning" ? "passed with warnings" : "passed"}. All critical checks run again when delivery starts.` : preview?.sendGuard?.status === "blocked" ? `Launch blocked: ${preview.sendGuard.blockingIssues.join(" ")}` : "Delivery setup is complete. Wait for the latest Review & preview before sending.") : "Delivery setup incomplete: choose an audience list, template and active sending account."}
    </div>

    <CampaignAttachments campaignId={campaign.id} />

    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
      <div className="mb-3"><p className="text-sm font-extrabold">Sender</p><p className="mt-0.5 text-xs text-[var(--muted)]">From email is locked to the approved sending identity selected above.</p></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <label><span className="mb-1.5 block text-sm font-bold">From name</span><div className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm font-bold text-[var(--foreground)]">{fromName || "Select a sending identity"}</div><input type="hidden" name="fromName" value={fromName} /></label>
        <label><span className="mb-1.5 block text-sm font-bold">From email</span><div className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm font-bold text-[var(--foreground)]">{fromEmail || "Select a sending identity"}</div><input type="hidden" name="fromEmail" value={fromEmail} /></label>
        <label><span className="mb-1.5 block text-sm font-bold">Schedule for later (IST)</span><input name="scheduledAt" type="datetime-local" value={schedule} onChange={(e)=>setSchedule(e.target.value)} className="form-control" /></label>
      </div>
      {selectedAccount ? <p className="mt-3 text-xs text-[var(--muted)]">Identity: {selectedAccount.fromName} &lt;{selectedAccount.fromEmail}&gt;{selectedAccount.replyTo ? ` · Reply-to: ${selectedAccount.replyTo}` : ""}</p> : null}
    </div>

    <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.045] p-4"><label className="flex cursor-pointer items-start gap-3"><input className="mt-1 h-4 w-4 accent-violet-600" type="checkbox" name="sendOnlyValidated" checked={sendOnlyValidated} onChange={(e)=>setSendOnlyValidated(e.target.checked)} /><span><span className="block text-sm font-black">Send only to validated recipients</span><span className="mt-1 block text-xs font-medium leading-5 text-[var(--muted)]">Only contacts with a current <strong>VALID</strong> validation result will enter the delivery queue. Invalid, unknown, pending and failed validation results are skipped.</span></span></label>{sendOnlyValidated && preview ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl bg-emerald-500/[.07] p-3"><p className="text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300">Will send</p><p className="mt-1 text-lg font-black">{preview.audience.validCount.toLocaleString()}</p></div><div className="rounded-xl bg-rose-500/[.06] p-3"><p className="text-[10px] font-black uppercase text-rose-700 dark:text-rose-300">Invalid</p><p className="mt-1 text-lg font-black">{preview.audience.invalidCount.toLocaleString()}</p></div><div className="rounded-xl bg-amber-500/[.06] p-3"><p className="text-[10px] font-black uppercase text-amber-700 dark:text-amber-300">Pending</p><p className="mt-1 text-lg font-black">{preview.audience.pendingCount.toLocaleString()}</p></div><div className="rounded-xl bg-zinc-500/[.06] p-3"><p className="text-[10px] font-black uppercase text-[var(--muted)]">Skipped</p><p className="mt-1 text-lg font-black">{Math.max(0, preview.audience.rawCount-preview.audience.validCount).toLocaleString()}</p></div></div>:null}</div>

    <section className="rounded-2xl border border-rose-500/25 bg-rose-500/[.055] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-600">!</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-rose-800 dark:text-rose-200">Recipient validation</p>
          <p className="mt-1 text-xs leading-5 text-rose-700 dark:text-rose-300">NexiMail has not independently validated all recipients. Sending without NexiMail validation can increase bounce rates and may affect sender reputation. Validation is recommended.</p>
          <div className="mt-3 space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <input type="radio" name="recipientValidationChoice" className="mt-0.5 accent-violet-600" checked={validationPolicy==="standard"} onChange={()=>{setValidationPolicy("standard");setValidationAcknowledged(false)}} />
              <span><span className="block text-xs font-black">Validate before sending <span className="text-emerald-600">(Recommended)</span></span><span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">Use NexiMail validation results as the send gate.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <input type="radio" name="recipientValidationChoice" className="mt-0.5 accent-violet-600" checked={validationPolicy==="previously_validated"} onChange={()=>{setValidationPolicy("previously_validated");setValidationAcknowledged(false)}} />
              <span><span className="block text-xs font-black">I have already validated these recipients elsewhere</span><span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">NexiMail will not require its own validation before this campaign.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <input type="radio" name="recipientValidationChoice" className="mt-0.5 accent-violet-600" checked={validationPolicy==="bypass_unvalidated"} onChange={()=>{setValidationPolicy("bypass_unvalidated");setValidationAcknowledged(false)}} />
              <span><span className="block text-xs font-black">Send without recipient validation</span><span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted)]">Proceed without an independent mailbox-validity check.</span></span>
            </label>
          </div>
          {requiresValidationAcknowledgement ? <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/[.06] p-3">
            <input type="checkbox" className="mt-0.5 accent-rose-600" checked={validationAcknowledged} onChange={(e)=>setValidationAcknowledged(e.target.checked)} />
            <span className="text-xs font-black leading-5 text-rose-800 dark:text-rose-200">I understand the risk and want to send without NexiMail validation.</span>
          </label> : null}
        </div>
      </div>
    </section>

    <div className="flex flex-wrap gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 text-sm font-bold"><label className="flex items-center gap-2"><input className="accent-violet-600" type="checkbox" name="trackOpens" defaultChecked={campaign.trackOpens} /> Track opens</label><label className="flex items-center gap-2"><input className="accent-violet-600" type="checkbox" name="trackClicks" defaultChecked={campaign.trackClicks} /> Track clicks</label></div>
    <p className="text-xs text-[var(--muted)]">NexiMail automatically adds a visible unsubscribe link and one-click unsubscribe headers at send time.</p>

    {showTest ? <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1"><span className="mb-1.5 block text-sm font-bold">Test recipient</span><input type="email" value={testRecipient} onChange={(e)=>setTestRecipient(e.target.value)} placeholder="you@example.com" className="form-control" /></label><button type="button" disabled={busy || !testReady} onClick={(event)=>{const form=event.currentTarget.form;if(form)void sendTest(form)}} className="btn-primary w-full sm:w-auto">{busy ? "Sending…" : "Send test"}</button><button type="button" onClick={()=>setShowTest(false)} className="btn-secondary w-full sm:w-auto">Cancel</button></div><p className="mt-2 text-[11px] text-[var(--muted)]">One real message through the configured MTA, with the same template and attachments, without joining the campaign audience.</p></div> : null}

    {error ? <p role="alert" aria-live="polite" className="rounded-xl border border-rose-500/15 bg-rose-500/[0.06] px-3.5 py-3 text-sm font-semibold text-rose-600">{error}</p> : null}
    {notice ? <p role="status" aria-live="polite" className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-3.5 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">{notice}</p> : null}

    <div className="sticky bottom-2 z-20 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--border)] bg-[color:var(--header-bg)] p-3 shadow-[0_18px_50px_rgba(20,28,45,.14)] backdrop-blur-xl sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
      <div className="contents sm:flex sm:flex-wrap sm:gap-2"><button disabled={busy} className="btn-secondary w-full sm:w-auto" type="submit">Save draft</button><button disabled={busy || !testReady} className="btn-secondary w-full sm:w-auto" type="button" onClick={()=>setShowTest(true)}>Send test</button></div>
      <div className="contents sm:flex sm:flex-wrap sm:gap-2"><button disabled={busy || !deliveryReady || !reviewReady || !schedule} className="btn-secondary w-full sm:w-auto" type="button" onClick={(event)=>{const form=event.currentTarget.form;if(form)void submit(new FormData(form),"schedule")}}>Schedule</button><button disabled={busy || !deliveryReady || !reviewReady} className="btn-primary col-span-2 w-full sm:w-auto" type="button" onClick={(event)=>{const form=event.currentTarget.form;if(form)void submit(new FormData(form),"send_now")}}>{busy ? "Working…" : preview ? `Send to ~${targetAudienceCount.toLocaleString()}` : "Send now"}</button></div>
    </div>

    {fullPreview && preview ? <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-5">
      <section role="dialog" aria-modal="true" aria-label="Campaign template preview" className="flex max-h-[96dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-3 sm:px-5">
          <div className="min-w-0"><p className="page-eyebrow">Campaign preview</p><p className="mt-1 truncate text-sm font-black sm:text-base">{preview.template.subject || preview.template.name}</p></div>
          <div className="flex shrink-0 items-center gap-2"><div className="flex rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1"><button type="button" aria-label="Desktop preview" onClick={()=>setPreviewMode("desktop")} className={`rounded-lg p-2 ${previewMode==="desktop"?"bg-[var(--surface)] text-violet-600 shadow-sm":"text-[var(--muted)]"}`}><Monitor className="h-4 w-4"/></button><button type="button" aria-label="Mobile preview" onClick={()=>setPreviewMode("mobile")} className={`rounded-lg p-2 ${previewMode==="mobile"?"bg-[var(--surface)] text-violet-600 shadow-sm":"text-[var(--muted)]"}`}><Smartphone className="h-4 w-4"/></button></div><button type="button" aria-label="Close preview" onClick={()=>setFullPreview(false)} className="icon-button grid"><X className="h-4 w-4"/></button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#e9edf5] p-2 sm:p-5"><div className={`mx-auto w-full overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm ${previewMode==="mobile"?"max-w-[390px]":"max-w-[760px]"}`}>{preview.template.html ? <iframe title="Full campaign email preview" sandbox="" srcDoc={previewDocument(preview.template.html)} className="h-[82dvh] w-full bg-white"/> : <pre className="h-[82dvh] overflow-auto whitespace-pre-wrap p-4 text-sm text-zinc-800">{preview.template.text || "Template has no content."}</pre>}</div></div>
      </section>
    </div> : null}
  </form>;
}
