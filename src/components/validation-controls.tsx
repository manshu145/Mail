"use client";

import {
  Activity, CheckCircle2, CircleDot, Gauge, KeyRound, Pause, Play, RotateCcw,
  SearchCheck, ShieldCheck, TimerReset, Trash2, UploadCloud, Zap, AlertTriangle
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ImportOption = { id: string; filename: string; unresolved: number };
type ListOption = { id: string; name: string; isDynamic: boolean; unresolved: number };
type ValidationMode = "internal" | "hybrid" | "supersend";

export function ValidationControls({
  paused, activeJob, unresolved, imports, engine,
}: {
  paused: boolean;
  activeJob: { id: string; scope: string; status: string; validationMode: string; processedRows: number; totalRows: number } | null;
  unresolved: number;
  imports: ImportOption[];
  engine: {
    state:string; scheduler:string; concurrency:number; providerStartGapMs:number;
    providerBackoffMs:number; hardTimeoutMs:number; validationMode:string;
    validationsPerMinute:number; targetPerSecond:number|null; providerHoldMs:number;
    providerHolds:number; lastSeenAt:string|null;
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
      const r = await fetch("/api/validation/provider", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return;
      setProviderConfigured(Boolean(d.configured)); setProviderHint(d.hint || null);
      setProviderSource(d.source || null); setProviderManage(Boolean(d.canManage));
      setProviderMode(d.mode || "internal");
    } catch {}
  }

  useEffect(() => {
    void loadProvider();
    void (async () => {
      try {
        const r = await fetch("/api/validation/control", { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (r.ok && Array.isArray(d.lists)) {
          setLists(d.lists);
          setListId((v) => v || d.lists?.[0]?.id || "");
        }
      } catch {}
    })();
  }, []);

  async function saveProviderKey() {
    if (!providerKey.trim()) { setProviderMessage("Enter a SuperSend API key."); return; }
    setProviderBusy(true); setProviderMessage("");
    try {
      const r = await fetch("/api/validation/provider", { method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({apiKey:providerKey.trim()}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setProviderMessage(d.error || "Could not save API key."); return; }
      setProviderKey(""); setProviderConfigured(true); setProviderHint(d.hint || "Configured");
      setProviderSource("workspace"); setProviderMessage("SuperSend API key saved securely.");
    } catch { setProviderMessage("Could not reach NexiMail."); }
    finally { setProviderBusy(false); }
  }

  async function saveProviderMode(mode: ValidationMode) {
    if (!providerManage || providerModeBusy) return;
    if (mode !== "internal" && !providerConfigured) { setProviderMessage("Add a SuperSend API key first."); return; }
    setProviderModeBusy(true); setProviderMessage("");
    try {
      const r = await fetch("/api/validation/provider", { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({mode}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setProviderMessage(d.error || "Could not change validation mode."); return; }
      setProviderMode(d.mode || mode); setProviderMessage("Validation mode updated for new jobs."); router.refresh();
    } catch { setProviderMessage("Could not reach NexiMail."); }
    finally { setProviderModeBusy(false); }
  }

  async function removeProviderKey() {
    if (!window.confirm("Remove the workspace SuperSend API key?")) return;
    setProviderBusy(true); setProviderMessage("");
    try {
      const r = await fetch("/api/validation/provider", { method:"DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setProviderMessage(d.error || "Could not remove API key."); return; }
      setProviderConfigured(Boolean(d.configured)); setProviderSource(d.source || null);
      setProviderHint(d.configured ? "Environment key" : null);
      if (d.mode) setProviderMode(d.mode);
      setProviderMessage(d.configured ? "Workspace key removed. Environment fallback remains active." : "Provider removed. Internal validation is active.");
    } catch { setProviderMessage("Could not reach NexiMail."); }
    finally { setProviderBusy(false); }
  }

  async function act(action: "start_pending"|"start_import"|"start_list"|"start_single"|"pause"|"resume"|"cancel") {
    if (action === "cancel" && !window.confirm("Cancel the active validation job? Completed results will be kept.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/validation/control", {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({action,email:email.trim(),importId,listId}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "Validation action failed."); return; }
      if (action === "pause") setNotice("Validation paused after the current check.");
      else if (action === "cancel") setNotice("Validation cancelled. Completed results were kept.");
      else if (action === "resume") setNotice("Validation resumed.");
      else setNotice("Validation queued" + (d.total ? " for " + d.total.toLocaleString() + " contacts" : "") + ".");
      if (action === "start_single") setEmail("");
      router.refresh();
    } catch { setError("Could not reach NexiMail."); }
    finally { setBusy(false); }
  }

  const progress = activeJob?.totalRows ? Math.min(100, activeJob.processedRows / activeJob.totalRows * 100) : 0;
  const remaining = activeJob ? Math.max(0, activeJob.totalRows - activeJob.processedRows) : 0;
  const rate = engine ? engine.validationsPerMinute / 60 : 0;
  const quotaReached = engine?.state === "daily_quota_exhausted";
  const state = quotaReached ? "Daily limit" : paused ? "Paused" : activeJob ? "Processing" : engine?.state === "error" ? "Attention" : "Ready";
  const modeLabel = (m:string) => m === "hybrid" ? "Smart Hybrid" : m === "supersend" ? "SuperSend Primary" : "NexiMail Internal";

  const actionCard = (icon:React.ReactNode, title:string, body:string, children:React.ReactNode) => (
    <div className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-violet-500/30 hover:shadow-[0_14px_40px_rgba(88,72,190,.08)]">
      <div className="mb-4 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">{icon}</div>
        <div><h3 className="text-sm font-black">{title}</h3><p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{body}</p></div>
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-violet-500/15 bg-[radial-gradient(circle_at_85%_0%,rgba(109,93,252,.16),transparent_38%),var(--surface)] p-5 shadow-[0_18px_55px_rgba(20,18,45,.08)] sm:p-7">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/15 bg-violet-500/8 px-3 py-1 text-[9px] font-black uppercase tracking-[.16em] text-violet-700 dark:text-violet-300">
              <ShieldCheck className="h-3.5 w-3.5"/> NexiMail Validation
            </div>
            <h1 className="text-2xl font-black tracking-[-.04em] sm:text-3xl">Know your audience before you send.</h1>
            <p className="mt-2 max-w-xl text-[12px] leading-5 text-[var(--muted)]">Validate unresolved contacts safely with controlled pacing, provider-aware safeguards and clear results. No recipient SMTP probing.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[330px]">
            {[
              ["Unresolved", unresolved.toLocaleString(), "text-amber-600"],
              ["Engine", state, state === "Ready" ? "text-emerald-600" : "text-violet-600"],
              ["Live rate", `${rate.toFixed(2)}/s`, "text-blue-600"],
            ].map(([l,v,c]) => <div key={l} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/85 px-3 py-3"><p className="text-[9px] font-black uppercase tracking-[.12em] text-[var(--muted)]">{l}</p><p className={`mt-1 truncate text-sm font-black ${c}`}>{v}</p></div>)}
          </div>
        </div>
      </section>

      {activeJob ? (
        <section className="overflow-hidden rounded-2xl border border-violet-500/20 bg-violet-500/[.035]">
          <div className="flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-[9px] font-black uppercase text-violet-700 dark:text-violet-300"><CircleDot className="h-3 w-3"/> {paused ? "Paused" : "Processing"}</span>
                <span className="text-[10px] font-bold text-[var(--muted)]">{modeLabel(activeJob.validationMode)}</span>
              </div>
              <p className="mt-2 truncate text-sm font-black">{activeJob.scope}</p>
              <p className="mt-1 font-mono text-[9px] text-[var(--muted)]">Job #{activeJob.id.slice(0,8)}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[[`Done`,activeJob.processedRows.toLocaleString()],[`Remaining`,remaining.toLocaleString()],[`Progress`,`${progress.toFixed(1)}%`]].map(([l,v]) => <div key={l} className="min-w-[72px] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2"><p className="text-[8px] font-black uppercase text-[var(--muted)]">{l}</p><p className="mt-1 text-xs font-black">{v}</p></div>)}
              </div>
              <button disabled={busy} onClick={()=>void act(paused ? "resume" : "cancel")} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-[11px] font-black ${paused ? "btn-secondary" : "btn-danger"}`}>{paused ? <Play className="h-3.5 w-3.5"/> : <Trash2 className="h-3.5 w-3.5"/>}{paused ? "Resume" : "Cancel"}</button>
            </div>
          </div>
          <div className="h-1 bg-[var(--border)]"><div className="h-full bg-violet-500 transition-all" style={{width:`${progress}%`}}/></div>
        </section>
      ) : null}

      {(notice || error) ? <div className={`rounded-xl border px-4 py-3 text-[11px] font-bold ${error ? "border-rose-500/20 bg-rose-500/5 text-rose-600" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"}`}>{error || notice}</div> : null}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><p className="page-eyebrow">Start validation</p><h2 className="section-title mt-1">Choose what to validate</h2></div>
          {!activeJob ? <button disabled={busy || unresolved === 0 || quotaReached} onClick={()=>void act(paused ? "resume" : "start_pending")} className="btn-primary !min-h-10 !px-4"><RotateCcw className="h-3.5 w-3.5"/>{paused ? "Resume engine" : "Validate unresolved"}</button> : null}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {actionCard(<SearchCheck className="h-5 w-5"/>, "Single contact", "Instantly queue one address for validation.",
            <div className="flex gap-2"><input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="person@example.com" className="form-control min-w-0 flex-1"/><button disabled={busy || !email.trim()} onClick={()=>void act("start_single")} className="btn-secondary !min-h-10 !px-4">Check</button></div>
          )}
          {actionCard(<UploadCloud className="h-5 w-5"/>, "Recent import", "Validate unresolved contacts from a CSV import.",
            <div className="space-y-2"><select value={importId} onChange={e=>setImportId(e.target.value)} className="form-control w-full">{imports.length ? imports.map(i=><option key={i.id} value={i.id}>{i.filename} · {i.unresolved.toLocaleString()} pending</option>) : <option>No imports need validation</option>}</select><button disabled={busy || !!activeJob || !importId} onClick={()=>void act("start_import")} className="btn-secondary !min-h-10 w-full">Validate import</button></div>
          )}
          {actionCard(<Activity className="h-5 w-5"/>, "List or segment", "Run validation across a saved audience.",
            <div className="space-y-2"><select value={listId} onChange={e=>setListId(e.target.value)} className="form-control w-full">{lists.length ? lists.map(i=><option key={i.id} value={i.id}>{i.name} · {i.isDynamic ? "segment" : "list"} · {i.unresolved.toLocaleString()}</option>) : <option>No audiences need validation</option>}</select><button disabled={busy || !!activeJob || !listId} onClick={()=>void act("start_list")} className="btn-secondary !min-h-10 w-full">Validate audience</button></div>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="border-b border-[var(--border)] p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="page-eyebrow">Validation engine</p><h2 className="section-title mt-1">How new jobs are checked</h2><p className="section-subtitle">Choose the method once; every new job snapshots the selected mode.</p></div><Zap className="h-5 w-5 text-violet-600"/></div></div>
          <div className="grid gap-2 p-3 sm:grid-cols-3 sm:p-4">
            {([
              ["internal","NexiMail Internal","Fast • no provider credits","Syntax + DNS/MX + available evidence."],
              ["hybrid","Smart Hybrid","Balanced","Internal first; SuperSend only for unresolved results."],
              ["supersend","SuperSend Primary","Provider powered","Every check uses SuperSend credits."],
            ] as Array<[ValidationMode,string,string,string]>).map(([mode,title,badge,body])=>{
              const unavailable=mode!=="internal" && !providerConfigured;
              const selected=providerMode===mode;
              return <button key={mode} disabled={!providerManage || providerModeBusy || unavailable} onClick={()=>void saveProviderMode(mode)} className={`relative rounded-2xl border p-4 text-left transition ${selected ? "border-violet-500/40 bg-violet-500/[.07] shadow-[0_10px_30px_rgba(109,93,252,.09)]" : "border-[var(--border)] bg-[var(--surface-soft)] hover:border-violet-500/25"} disabled:cursor-not-allowed disabled:opacity-50`}>
                {selected ? <span className="absolute right-3 top-3"><CheckCircle2 className="h-4 w-4 text-violet-600"/></span> : null}
                <div className="text-[9px] font-black uppercase tracking-[.1em] text-[var(--muted)]">{badge}</div>
                <h3 className="mt-2 text-[12px] font-black">{title}</h3>
                <p className="mt-1 text-[10.5px] leading-4 text-[var(--muted)]">{body}</p>
                {unavailable ? <p className="mt-3 text-[9px] font-black text-amber-600">SuperSend key required</p> : null}
              </button>;
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="border-b border-[var(--border)] p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="page-eyebrow">Live engine</p><h2 className="section-title mt-1">Runtime</h2></div><Gauge className="h-5 w-5 text-violet-600"/></div></div>
          <div className="grid grid-cols-2">
            {[
              ["Status",state],["Rate",engine ? `${rate.toFixed(2)}/s`:"—"],["Throughput",engine ? `${engine.validationsPerMinute.toFixed(1)}/min`:"—"],["Concurrency",engine ? String(engine.concurrency):"—"],["Target",engine?.targetPerSecond ? `${engine.targetPerSecond}/s`:"Adaptive"],["Provider holds",engine ? String(engine.providerHolds || 0):"—"]
            ].map(([l,v])=><div key={l} className="border-b border-r border-[var(--border)] bg-[var(--surface)] px-4 py-3"><p className="text-[8px] font-black uppercase tracking-[.1em] text-[var(--muted)]">{l}</p><p className="mt-1 text-sm font-black">{v}</p></div>)}
          </div>
          <div className="p-4 text-[10.5px] leading-5 text-[var(--muted)]">{quotaReached ? "Daily validation quota reached. Pending work will continue when capacity resets." : "Provider-aware pacing and temporary-error backoff protect the validation pipeline."}</div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="border-b border-[var(--border)] p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="page-eyebrow">External provider</p><h2 className="section-title mt-1">SuperSend</h2></div><KeyRound className="h-5 w-5 text-violet-600"/></div></div>
          <div className="p-4 sm:p-5">
            <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"><div><p className="text-[9px] font-black uppercase text-[var(--muted)]">Status</p><p className="mt-1 text-sm font-black">{providerConfigured === null ? "Checking…" : providerConfigured ? "Configured" : "Not configured"}</p></div><span className={`rounded-full px-2.5 py-1 text-[8px] font-black uppercase ${providerConfigured ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{providerConfigured ? providerSource === "workspace" ? "Workspace" : "Environment" : "Optional"}</span></div>
            {providerConfigured && providerHint ? <p className="mt-3 truncate rounded-lg bg-[var(--surface-soft)] px-3 py-2 font-mono text-[10px] text-[var(--muted)]">{providerHint}</p> : null}
            {providerManage ? <div className="mt-3 space-y-2"><input type="password" autoComplete="new-password" value={providerKey} onChange={e=>setProviderKey(e.target.value)} placeholder={providerConfigured ? "Replace API key" : "Paste SuperSend API key"} className="form-control"/><div className="flex gap-2"><button disabled={providerBusy || !providerKey.trim()} onClick={()=>void saveProviderKey()} className="btn-primary !min-h-10 flex-1">{providerBusy ? "Saving…" : providerConfigured ? "Replace key" : "Save key"}</button>{providerSource === "workspace" ? <button disabled={providerBusy} onClick={()=>void removeProviderKey()} className="btn-danger !min-h-10 !px-3" aria-label="Remove key"><Trash2 className="h-4 w-4"/></button> : null}</div></div> : <p className="mt-3 text-[10.5px] text-[var(--muted)]">Owner access is required to manage the provider.</p>}
            {providerMessage ? <p className="mt-3 text-[10.5px] font-bold text-[var(--muted)]">{providerMessage}</p> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="border-b border-[var(--border)] p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="page-eyebrow">Safety layer</p><h2 className="section-title mt-1">Built to protect your sending reputation</h2></div><ShieldCheck className="h-5 w-5 text-emerald-600"/></div></div>
          <div className="grid sm:grid-cols-2">
            {[
              [<ShieldCheck className="h-4 w-4"/>, "Safe checks", "DNS/MX validation does not probe recipient SMTP servers."],
              [<Gauge className="h-4 w-4"/>, "Adaptive pacing", "Provider lanes, rate limits and backoff prevent aggressive bursts."],
              [<TimerReset className="h-4 w-4"/>, "Temporary holds", "Transient provider failures pause safely instead of forcing false invalids."],
              [<CheckCircle2 className="h-4 w-4"/>, "Conservative results", "Only explicit invalid evidence becomes an invalid mailbox verdict."],
            ].map(([icon,title,body],i)=><div key={String(title)} className={`p-4 ${i%2 ? "border-l border-[var(--border)]" : ""} ${i>1 ? "border-t border-[var(--border)]" : ""}`}><div className="flex gap-3"><div className="text-violet-600">{icon}</div><div><p className="text-[11px] font-black">{title}</p><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{body}</p></div></div></div>)}
          </div>
        </div>
      </section>

      {quotaReached ? <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10.5px] text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/><span>Daily validation capacity has been reached. New bulk validation is temporarily paused; existing work will continue when capacity resets.</span></div> : null}
    </div>
  );
}
