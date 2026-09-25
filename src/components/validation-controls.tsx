"use client";

import { Activity, Gauge, KeyRound, Pause, Play, RotateCcw, SearchCheck, ShieldCheck, TimerReset, Trash2, UploadCloud, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ImportOption = { id: string; filename: string; unresolved: number };
type ListOption = { id: string; name: string; isDynamic: boolean; unresolved: number };
type ValidationMode = "internal" | "hybrid" | "supersend";

export function ValidationControls({
  paused,
  activeJob,
  unresolved,
  imports,
  engine,
}: {
  paused: boolean;
  activeJob: { id: string; scope: string; status: string; validationMode: string; processedRows: number; totalRows: number } | null;
  unresolved: number;
  imports: ImportOption[];
  engine: {
    state:string;
    scheduler:string;
    concurrency:number;
    providerStartGapMs:number;
    providerBackoffMs:number;
    hardTimeoutMs:number;
    validationMode:string;
    validationsPerMinute:number;
    targetPerSecond:number|null;
    providerHoldMs:number;
    providerHolds:number;
    lastSeenAt:string|null;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [importId, setImportId] = useState(imports[0]?.id || "");
  const [lists, setLists] = useState<ListOption[]>([]);
  const [listId, setListId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [providerHint, setProviderHint] = useState<string | null>(null);
  const [providerSource, setProviderSource] = useState<"workspace"|"environment"|null>(null);
  const [providerManage, setProviderManage] = useState(false);
  const [providerKey, setProviderKey] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState("");
  const [providerMode, setProviderMode] = useState<ValidationMode>("internal");
  const [providerModeBusy, setProviderModeBusy] = useState(false);

  async function loadProvider() {
    try {
      const response = await fetch("/api/validation/provider", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as {
        configured?: boolean;
        hint?: string | null;
        source?: "workspace" | "environment" | null;
        canManage?: boolean;
        mode?: ValidationMode;
      };
      if (!response.ok) return;
      setProviderConfigured(Boolean(data.configured));
      setProviderHint(data.hint || null);
      setProviderSource(data.source || null);
      setProviderManage(Boolean(data.canManage));
      setProviderMode(data.mode || "internal");
    } catch {}
  }

  useEffect(() => {
    void loadProvider();
    void (async () => {
      try {
        const response = await fetch("/api/validation/control", { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as { lists?: ListOption[] };
        if (response.ok && Array.isArray(data.lists)) {
          setLists(data.lists);
          setListId((current) => current || data.lists?.[0]?.id || "");
        }
      } catch {}
    })();
  }, []);

  async function saveProviderKey() {
    if (!providerKey.trim()) { setProviderMessage("Enter a SuperSend API key."); return; }
    setProviderBusy(true); setProviderMessage("");
    try {
      const response = await fetch("/api/validation/provider", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: providerKey.trim() }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; hint?: string };
      if (!response.ok) { setProviderMessage(data.error || "Could not save API key."); return; }
      setProviderKey("");
      setProviderConfigured(true);
      setProviderHint(data.hint || "Configured");
      setProviderSource("workspace");
      setProviderMessage("SuperSend API key saved securely.");
    } catch {
      setProviderMessage("Could not reach NexiMail.");
    } finally { setProviderBusy(false); }
  }

  async function saveProviderMode(mode: ValidationMode) {
    if (!providerManage || providerModeBusy) return;
    if (mode !== "internal" && !providerConfigured) {
      setProviderMessage("Add a SuperSend API key before selecting this mode.");
      return;
    }
    setProviderModeBusy(true); setProviderMessage("");
    try {
      const response = await fetch("/api/validation/provider", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; mode?: ValidationMode };
      if (!response.ok) { setProviderMessage(data.error || "Could not change validation mode."); return; }
      setProviderMode(data.mode || mode);
      setProviderMessage("Validation mode saved. New jobs will use this method.");
      router.refresh();
    } catch {
      setProviderMessage("Could not reach NexiMail.");
    } finally {
      setProviderModeBusy(false);
    }
  }

  async function removeProviderKey() {
    if (!window.confirm("Remove the workspace SuperSend API key?")) return;
    setProviderBusy(true); setProviderMessage("");
    try {
      const response = await fetch("/api/validation/provider", { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { error?: string; configured?: boolean; source?: "environment" | null; mode?: ValidationMode };
      if (!response.ok) { setProviderMessage(data.error || "Could not remove API key."); return; }
      setProviderConfigured(Boolean(data.configured));
      setProviderSource(data.source || null);
      setProviderHint(data.configured ? "Environment key" : null);
      if (data.mode) setProviderMode(data.mode);
      setProviderMessage(data.configured ? "Workspace key removed. Environment fallback is still active." : "SuperSend API key removed. Validation default returned to NexiMail internal.");
    } catch {
      setProviderMessage("Could not reach NexiMail.");
    } finally { setProviderBusy(false); }
  }

  async function act(action: "start_pending"|"start_import"|"start_list"|"start_single"|"pause"|"resume"|"cancel") {
    if (action === "cancel" && !window.confirm("Cancel the active validation job? Completed results will be kept and the job will not resume.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/validation/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, email: email.trim(), importId, listId }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; total?: number };
      if (!response.ok) { setError(data.error || "Validation action failed."); return; }
      if (action === "pause") setNotice("Validation paused after the current check.");
      else if (action === "cancel") setNotice("Validation job cancelled. Completed results were kept.");
      else if (action === "resume") setNotice("Validation resumed.");
      else setNotice("Validation queued" + (data.total ? " for " + data.total.toLocaleString() + " contact" + (data.total === 1 ? "" : "s") : "") + ".");
      if (action === "start_single") setEmail("");
      router.refresh();
    } catch {
      setError("Could not reach NexiMail. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const validationReady = true;
  const progress = activeJob?.totalRows ? Math.min(100, activeJob.processedRows / activeJob.totalRows * 100) : 0;
  const remaining = activeJob ? Math.max(0, activeJob.totalRows - activeJob.processedRows) : 0;
  const currentPerSecond = engine ? engine.validationsPerMinute / 60 : 0;
  const modeLabel = (mode: string) => mode === "hybrid" ? "Smart Hybrid" : mode === "supersend" ? "SuperSend Primary" : "NexiMail Internal";
  const quotaReached = engine?.state === "daily_quota_exhausted";
  const engineState = quotaReached ? "Daily limit reached" : paused ? "Paused" : activeJob ? "Processing" : engine?.state === "error" ? "Attention" : "Ready";

  return <div className="space-y-4 sm:space-y-5">
    <section className="premium-panel overflow-hidden">
      <div className="section-header !items-stretch !gap-3 max-sm:!flex-col sm:!items-center">
        <div className="min-w-0">
          <p className="page-eyebrow">Validation control</p>
          <h2 className="section-title mt-1">Mailbox checks</h2>
          <p className="section-subtitle max-w-2xl">Run bulk or single-contact validation with safe cancellation. Provider-aware pacing, safety holds and retries stay automatic.</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {activeJob
            ? <button disabled={busy} type="button" onClick={() => act("cancel")} className="btn-danger !min-h-10 !px-3"><Trash2 className="h-3.5 w-3.5"/> Cancel validation</button>
            : paused
              ? <button disabled={busy} type="button" onClick={() => act("resume")} className="btn-secondary !min-h-10 !px-3"><Play className="h-3.5 w-3.5"/> Resume</button>
              : <button disabled={busy || quotaReached} type="button" onClick={() => act("pause")} className="btn-secondary !min-h-10 !px-3"><Pause className="h-3.5 w-3.5"/> Pause</button>
          <button disabled={busy || !!activeJob || unresolved === 0 || !validationReady} type="button" onClick={() => act("start_pending")} className="btn-primary !min-h-10 !px-3"><RotateCcw className="h-3.5 w-3.5"/> Validate unresolved</button>}
        </div>
      </div>

      {activeJob ? <div className="border-b border-[var(--border)] bg-[linear-gradient(120deg,rgba(109,93,252,.06),rgba(75,124,255,.035))] px-3 py-4 sm:px-4">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="live-dot" />
              <b className="text-[12px] sm:text-[13px]">Active validation job</b>
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-black uppercase text-blue-700 dark:text-blue-300">{paused ? "paused" : activeJob.status}</span>
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[9px] font-black text-violet-700 dark:text-violet-300">{modeLabel(activeJob.validationMode)}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--muted)]"><span className="truncate">{activeJob.scope}</span><span>#{activeJob.id.slice(0,8)}</span></div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[300px]">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"><p className="text-[9px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Done</p><p className="mt-1 text-sm font-black">{activeJob.processedRows.toLocaleString()}</p></div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"><p className="text-[9px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Left</p><p className="mt-1 text-sm font-black">{remaining.toLocaleString()}</p></div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"><p className="text-[9px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Progress</p><p className="mt-1 text-sm font-black">{progress.toFixed(2)}%</p></div>
          </div>
        </div>
        <div className="progress-track mt-3"><div className="progress-fill" style={{width:`${progress}%`}} /></div>
      </div> : null}

      <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5 sm:p-4">
          <div className="mb-3 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><SearchCheck className="h-4 w-4"/></div><div className="min-w-0"><h3 className="text-[12px] font-black">Validate one contact</h3><p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">Priority-check an existing Pending, Unknown or Error contact.</p></div></div>
          <div className="flex flex-col gap-2 sm:flex-row"><input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" placeholder="person@example.com" className="form-control min-w-0 flex-1"/><button type="button" disabled={busy || !email.trim() || !validationReady} onClick={()=>act("start_single")} className="btn-secondary !min-h-10 shrink-0 !px-4">Validate</button></div>
          <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">{activeJob ? "Queued as a priority check; the bulk job keeps its progress and resumes automatically." : "Runs through the currently selected validation method."}</p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5 sm:p-4">
          <div className="mb-3 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300"><UploadCloud className="h-4 w-4"/></div><div className="min-w-0"><h3 className="text-[12px] font-black">Validate recent import</h3><p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">Start a job for unresolved contacts from a CSV import.</p></div></div>
          <div className="flex flex-col gap-2 sm:flex-row"><select value={importId} onChange={(e)=>setImportId(e.target.value)} className="form-control min-w-0 flex-1">{imports.length ? imports.map((item)=><option key={item.id} value={item.id}>{item.filename} · {item.unresolved.toLocaleString()}</option>) : <option value="">No imports need validation</option>}</select><button type="button" disabled={busy || !!activeJob || !importId || !validationReady} onClick={()=>act("start_import")} className="btn-secondary !min-h-10 shrink-0 !px-4">Validate import</button></div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5 sm:p-4 lg:col-span-2">
          <div className="mb-3 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"><SearchCheck className="h-4 w-4"/></div><div className="min-w-0"><h3 className="text-[12px] font-black">Validate a list or segment</h3><p className="mt-0.5 text-[11px] leading-4 text-[var(--muted)]">Select a saved audience. Large audiences are automatically processed within the daily validation quota and continue on the next day.</p></div></div>
          <div className="flex flex-col gap-2 sm:flex-row"><select value={listId} onChange={(e)=>setListId(e.target.value)} className="form-control min-w-0 flex-1">{lists.length ? lists.map((item)=><option key={item.id} value={item.id}>{item.name} · {item.isDynamic ? "segment" : "list"} · {item.unresolved.toLocaleString()} pending</option>) : <option value="">No lists or segments need validation</option>}</select><button type="button" disabled={busy || !!activeJob || !listId || !validationReady} onClick={()=>act("start_list")} className="btn-secondary !min-h-10 shrink-0 !px-4">Validate audience</button></div>
        </div>
      </div>

      {(notice||error)?<div className="border-t border-[var(--border)] px-4 py-3">{notice?<p role="status" className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{notice}</p>:null}{error?<p role="alert" className="text-[11px] font-bold text-rose-600">{error}</p>:null}</div>:null}
    </section>

    <div className="grid gap-4 xl:grid-cols-[1.14fr_.86fr]">
      <section className="premium-panel overflow-hidden">
        <div className="section-header">
          <div><p className="page-eyebrow">Validation method</p><h2 className="section-title mt-1">Choose the engine for new jobs</h2><p className="section-subtitle">The method is snapshotted when a job starts, so changing this never mutates a running job.</p></div>
          <ShieldCheck className="h-5 w-5 shrink-0 text-violet-600"/>
        </div>
        <div className="grid gap-2.5 p-3 sm:p-4 md:grid-cols-3">
          {([
            ["internal","NexiMail Internal","No external credits","Syntax + MX only. Mailbox-level checks use SuperSend or delivery evidence."],
            ["hybrid","Smart Hybrid","Credit-saving fallback","NexiMail checks first. Only unresolved results use SuperSend fallback."],
            ["supersend","SuperSend Primary","External provider","Every new validation check goes through SuperSend and uses provider credits."],
          ] as Array<[ValidationMode,string,string,string]>).map(([mode,title,badge,body])=>{
            const unavailable=mode!=="internal" && !providerConfigured;
            const selected=providerMode===mode;
            return <button key={mode} type="button" disabled={!providerManage || providerModeBusy || unavailable} onClick={()=>void saveProviderMode(mode)} className={`group min-h-[138px] rounded-2xl border p-3.5 text-left transition ${selected?"border-violet-500/30 bg-violet-500/[0.07] shadow-[0_10px_28px_rgba(109,93,252,.08)]":"border-[var(--border)] bg-[var(--surface-soft)] hover:border-violet-500/20 hover:bg-violet-500/[.025]"} disabled:cursor-not-allowed disabled:opacity-55`}>
              <div className="flex items-start justify-between gap-2"><div className={`grid h-8 w-8 place-items-center rounded-lg ${selected?"bg-violet-500/10 text-violet-700 dark:text-violet-300":"bg-[var(--surface)] text-[var(--muted)]"}`}>{mode==="internal"?<ShieldCheck className="h-4 w-4"/>:mode==="hybrid"?<Zap className="h-4 w-4"/>:<Activity className="h-4 w-4"/>}</div><span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-[.08em] ${selected?"bg-violet-500/10 text-violet-700 dark:text-violet-300":"bg-[var(--surface)] text-[var(--muted)]"}`}>{selected?"Active":unavailable?"Needs key":badge}</span></div>
              <p className="mt-3 text-[12px] font-black">{title}</p><p className="mt-1.5 text-[10.5px] leading-4 text-[var(--muted)]">{body}</p>
            </button>;
          })}
        </div>
      </section>

      <section className="premium-panel overflow-hidden">
        <div className="section-header"><div><p className="page-eyebrow">Live engine</p><h2 className="section-title mt-1">Runtime telemetry</h2></div><Gauge className="h-5 w-5 shrink-0 text-violet-600"/></div>
        <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-3 xl:grid-cols-2">
          {[
            ["State",engineState],
            ["Live rate",engine ? `${currentPerSecond.toFixed(2)}/s` : "—"],
            ["Throughput",engine ? `${engine.validationsPerMinute.toFixed(1)}/min` : "—"],
            ["Target",engine?.targetPerSecond ? `${engine.targetPerSecond}/s` : "Adaptive"],
            ["Concurrency",engine ? String(engine.concurrency) : "—"],
            ["Start gap",engine?.providerStartGapMs ? `${engine.providerStartGapMs} ms` : "—"],
            ["Backoff",engine?.providerBackoffMs ? `${Math.round(engine.providerBackoffMs/1000)} sec` : "—"],
            ["Provider holds",engine ? String(engine.providerHolds || 0) : "—"],
          ].map(([label,value])=><div key={label} className="bg-[var(--surface)] px-3 py-3 sm:px-4"><p className="text-[9px] font-black uppercase tracking-[.1em] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-[12px] font-black sm:text-sm">{value}</p></div>)}
        </div>
        <div className="border-t border-[var(--border)] px-4 py-3 text-[10.5px] leading-5 text-[var(--muted)]">{quotaReached ? "The workspace daily validation quota has been reached. The active job remains queued and will automatically continue when the daily quota resets." : "Provider-aware lanes raise throughput while shared pacing, temporary-error backoff and provider holds protect result quality."} A provider block pauses that provider instead of converting untouched mailboxes into false verdicts.</div>
      </section>
    </div>

    <div className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
      <section className="premium-panel overflow-hidden">
        <div className="section-header"><div><p className="page-eyebrow">External provider</p><h2 className="section-title mt-1">SuperSend API key</h2></div><KeyRound className="h-5 w-5 shrink-0 text-violet-600"/></div>
        <div className="p-3.5 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5">
            <div className="min-w-0"><p className="text-[10px] font-bold text-[var(--muted)]">Provider status</p><p className="mt-0.5 truncate text-[11.5px] font-black">{providerConfigured===null?"Checking…":providerConfigured?"Configured":"Not configured"}</p></div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase ${providerConfigured?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":"bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{providerConfigured ? (providerSource==="workspace"?"Workspace":"Environment") : "Optional"}</span>
          </div>

          {providerConfigured && providerHint ? <p className="mb-3 truncate rounded-lg bg-[var(--surface-soft)] px-3 py-2 font-mono text-[11px] text-[var(--muted)]">Saved key: {providerHint}</p> : null}

          {providerManage ? <div className="space-y-2">
            <input type="password" autoComplete="new-password" value={providerKey} onChange={(e)=>setProviderKey(e.target.value)} placeholder={providerConfigured?"Paste a new key to replace current":"Paste SuperSend API key"} className="form-control"/>
            <div className="flex gap-2">
              <button type="button" disabled={providerBusy || !providerKey.trim()} onClick={()=>void saveProviderKey()} className="btn-primary !min-h-10 flex-1 !px-3">{providerBusy?"Saving…":providerConfigured?"Replace key":"Save key"}</button>
              {providerSource==="workspace"?<button type="button" disabled={providerBusy} onClick={()=>void removeProviderKey()} className="btn-danger !min-h-10 !px-3" aria-label="Remove SuperSend API key"><Trash2 className="h-3.5 w-3.5"/></button>:null}
            </div>
          </div> : <p className="text-[11px] leading-4 text-[var(--muted)]">Owner access is required to manage the provider key.</p>}

          {providerMessage?<p className="mt-2 text-[11px] font-bold text-[var(--muted)]">{providerMessage}</p>:null}
          <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">Stored encrypted. The full key is never shown again. Campaign sending does not depend on SuperSend.</p>
        </div>
      </section>

      <section className="premium-panel overflow-hidden">
        <div className="section-header"><div><p className="page-eyebrow">How it works</p><h2 className="section-title mt-1">V2 validation safeguards</h2></div><TimerReset className="h-5 w-5 shrink-0 text-violet-600"/></div>
        <div className="grid sm:grid-cols-2">
          {[
            ["Provider-aware","Major mailbox providers use separate lanes, pacing and backoff so one provider cannot stall the whole validation job."],
            ["Safe invalids","Only explicit mailbox-missing or invalid-domain evidence becomes Invalid and is suppressed."],
            ["Temporary holds","DNS/MX checks never probe recipient SMTP servers. External mailbox validation and delivery evidence remain the mailbox-level sources."],
            ["Bounded probes","DNS checks have deadlines, preventing one stalled network operation from freezing bulk progress."],
          ].map(([title,body],index)=><div key={title} className={`p-4 ${index>0?"border-t border-[var(--border)] sm:border-t-0":""} ${index%2===1?"sm:border-l sm:border-[var(--border)]":""} ${index>=2?"sm:border-t sm:border-[var(--border)]":""}`}><div className="flex items-start gap-3"><div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300">{index===0?<Gauge className="h-3.5 w-3.5"/>:index===1?<ShieldCheck className="h-3.5 w-3.5"/>:index===2?<TimerReset className="h-3.5 w-3.5"/>:<Activity className="h-3.5 w-3.5"/>}</div><div><p className="text-[11px] font-black">{title}</p><p className="mt-1 text-[10.5px] leading-4.5 text-[var(--muted)]">{body}</p></div></div></div>)}
        </div>
      </section>
    </div>
  </div>;
}
