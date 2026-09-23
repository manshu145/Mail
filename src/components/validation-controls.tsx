"use client";

import { KeyRound, Pause, Play, RotateCcw, SearchCheck, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ImportOption = { id: string; filename: string; unresolved: number };
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
    lastSeenAt:string|null;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [importId, setImportId] = useState(imports[0]?.id || "");
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

  useEffect(() => { void loadProvider(); }, []);

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

  async function act(action: "start_pending"|"start_import"|"start_single"|"pause"|"resume") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/validation/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, email: email.trim(), importId }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; total?: number };
      if (!response.ok) { setError(data.error || "Validation action failed."); return; }
      if (action === "pause") setNotice("Validation paused after the current check.");
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

  return <div className="grid gap-4 xl:grid-cols-[1.45fr_.7fr]">
    <section className="premium-panel overflow-hidden">
      <div className="section-header">
        <div>
          <p className="page-eyebrow">Validation control</p>
          <h2 className="section-title mt-1">Mailbox checks</h2>
          <p className="section-subtitle">Internal syntax, MX and SMTP recipient checks across email domains. SuperSend is optional.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {paused
            ? <button disabled={busy} type="button" onClick={() => act("resume")} className="btn-secondary !min-h-9 !px-3"><Play className="h-3.5 w-3.5"/> Resume</button>
            : <button disabled={busy} type="button" onClick={() => act("pause")} className="btn-secondary !min-h-9 !px-3"><Pause className="h-3.5 w-3.5"/> Pause</button>}
          <button disabled={busy || !!activeJob || unresolved === 0 || !validationReady} type="button" onClick={() => act("start_pending")} className="btn-primary !min-h-9 !px-3"><RotateCcw className="h-3.5 w-3.5"/> Validate unresolved</button>
        </div>
      </div>

      {activeJob ? <div className="border-b border-[var(--border)] bg-blue-500/[0.035] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-500"/><b className="text-xs">Active validation job</b><span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-black uppercase text-blue-700 dark:text-blue-300">{paused ? "paused" : activeJob.status}</span><span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-black text-violet-700 dark:text-violet-300">{activeJob.validationMode==="hybrid"?"Smart hybrid":activeJob.validationMode==="supersend"?"SuperSend primary":"NexiMail internal"}</span></div><div className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{activeJob.scope} · {activeJob.id.slice(0,8)}</div></div>
          <div className="text-right"><div className="text-[11px] font-black text-[var(--foreground)]">{activeJob.totalRows ? (activeJob.processedRows/activeJob.totalRows*100).toFixed(2) : "0.00"}%</div><div className="text-[11px] font-bold text-[var(--muted)]">{activeJob.processedRows.toLocaleString()} / {activeJob.totalRows.toLocaleString()}</div></div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-violet-500 transition-all" style={{width:(activeJob.totalRows ? Math.min(100, activeJob.processedRows / activeJob.totalRows * 100) : 0) + "%"}}/></div>
      </div> : null}

      <div className="grid gap-3 p-4 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5">
          <div className="mb-3 flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300"><SearchCheck className="h-4 w-4"/></div><div><h3 className="text-[12px] font-black">Validate one contact</h3><p className="mt-0.5 text-[12px] leading-4 text-[var(--muted)]">Existing contact with Pending, Unknown or Error status.</p></div></div>
          <div className="flex gap-2"><input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" placeholder="person@example.com" className="form-control min-w-0 flex-1"/><button type="button" disabled={busy || !email.trim() || !validationReady} onClick={()=>act("start_single")} className="btn-secondary !min-h-10 shrink-0 !px-3">Validate</button></div><p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">{activeJob ? "Priority check: this contact can be checked while the bulk job keeps its progress and resumes automatically." : "Runs immediately through the same internal SMTP validator."}</p>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5">
          <div className="mb-3 flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300"><UploadCloud className="h-4 w-4"/></div><div><h3 className="text-[12px] font-black">Validate recent import</h3><p className="mt-0.5 text-[12px] leading-4 text-[var(--muted)]">All unresolved contacts from that CSV import.</p></div></div>
          <div className="flex gap-2"><select value={importId} onChange={(e)=>setImportId(e.target.value)} className="form-control min-w-0 flex-1">{imports.length ? imports.map((item)=><option key={item.id} value={item.id}>{item.filename} · {item.unresolved}</option>) : <option value="">No imports need validation</option>}</select><button type="button" disabled={busy || !!activeJob || !importId || !validationReady} onClick={()=>act("start_import")} className="btn-secondary !min-h-10 shrink-0 !px-3">Validate import</button></div>
        </div>
      </div>

      {(notice||error)?<div className="border-t border-[var(--border)] px-4 py-3">{notice?<p role="status" className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{notice}</p>:null}{error?<p role="alert" className="text-[11px] font-bold text-rose-600">{error}</p>:null}</div>:null}
    </section>

    <aside className="space-y-4">
      <section className="premium-panel overflow-hidden">
        <div className="section-header"><div><p className="page-eyebrow">Live engine</p><h2 className="section-title mt-1">Fast validator</h2></div><SearchCheck className="h-5 w-5 text-violet-600"/></div>
        <div className="grid grid-cols-2 gap-px bg-[var(--border)]">
          {[
            ["State",engine?.state || "unknown"],
            ["Method",engine?.validationMode==="hybrid"?"Smart hybrid":engine?.validationMode==="supersend"?"SuperSend primary":"NexiMail internal"],
            ["Scheduler",engine?.scheduler === "provider_aware" ? "Provider-aware" : engine?.scheduler || "Sequential"],
            ["Concurrency",engine ? String(engine.concurrency) : "—"],
            ["Throughput",engine ? `${engine.validationsPerMinute.toFixed(1)}/min` : "—"],
            ["Provider gap",engine?.providerStartGapMs ? `${engine.providerStartGapMs} ms` : "—"],
            ["Backoff",engine?.providerBackoffMs ? `${Math.round(engine.providerBackoffMs/1000)} sec` : "—"],
          ].map(([label,value])=><div key={label} className="bg-[var(--surface)] px-4 py-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">{label}</p><p className="mt-1 text-sm font-black">{value}</p></div>)}
        </div>
        <div className="border-t border-[var(--border)] px-4 py-3 text-[11px] leading-5 text-[var(--muted)]">Provider-aware lanes increase bulk speed while keeping provider-wide pacing and temporary-error backoff. Individual probes are bounded so a stalled DNS/SMTP request cannot freeze the whole job.</div>
      </section>

      <section className="premium-panel overflow-hidden">
        <div className="section-header"><div><p className="page-eyebrow">Validation method</p><h2 className="section-title mt-1">Choose how NexiMail validates</h2></div><ShieldCheck className="h-5 w-5 text-violet-600"/></div>
        <div className="space-y-2 p-4">
          {([
            ["internal","NexiMail internal","No external credits","Syntax + MX + direct SMTP RCPT checks. Best default when you want validation fully inside NexiMail."],
            ["hybrid","Smart hybrid","Credit-saving fallback","NexiMail checks first. Only Unknown/Error results are sent to SuperSend, so external credits are used selectively."],
            ["supersend","SuperSend primary","External provider","Every new validation check goes through SuperSend. This consumes SuperSend verification credits."],
          ] as Array<[ValidationMode,string,string,string]>).map(([mode,title,badge,body])=>{
            const unavailable=mode!=="internal" && !providerConfigured;
            const selected=providerMode===mode;
            return <button key={mode} type="button" disabled={!providerManage || providerModeBusy || unavailable} onClick={()=>void saveProviderMode(mode)} className={`w-full rounded-xl border p-3 text-left transition ${selected?"border-violet-500/30 bg-violet-500/[0.07]":"border-[var(--border)] bg-[var(--surface-soft)] hover:border-violet-500/20"} disabled:cursor-not-allowed disabled:opacity-55`}>
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black">{title}</p><p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{body}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase ${selected?"bg-violet-500/10 text-violet-700 dark:text-violet-300":"bg-[var(--surface)] text-[var(--muted)]"}`}>{selected?"Active":badge}</span></div>
            </button>;
          })}
          <p className="pt-1 text-[10px] leading-4 text-[var(--muted)]">The selected method is snapshotted when a validation job starts. Changing the default never changes a job that is already running.</p>
        </div>
      </section>

      <section className="premium-panel overflow-hidden">
        <div className="section-header"><div><p className="page-eyebrow">External provider</p><h2 className="section-title mt-1">SuperSend API key</h2></div><KeyRound className="h-5 w-5 text-violet-600"/></div>
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5">
            <div><p className="text-[11px] font-bold text-[var(--muted)]">Status</p><p className="mt-0.5 text-[11.5px] font-black">{providerConfigured===null?"Checking…":providerConfigured?"Configured":"Not configured"}</p></div>
            <span className={`rounded-full px-2 py-1 text-[11px] font-black uppercase ${providerConfigured?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":"bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{providerConfigured ? (providerSource==="workspace"?"Workspace":"Environment") : "Optional"}</span>
          </div>

          {providerConfigured && providerHint ? <p className="mb-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2 font-mono text-[12px] text-[var(--muted)]">Saved key: {providerHint}</p> : null}

          {providerManage ? <div className="space-y-2">
            <input type="password" autoComplete="new-password" value={providerKey} onChange={(e)=>setProviderKey(e.target.value)} placeholder={providerConfigured?"Paste a new key to replace current":"Paste SuperSend API key"} className="form-control"/>
            <div className="flex gap-2">
              <button type="button" disabled={providerBusy || !providerKey.trim()} onClick={()=>void saveProviderKey()} className="btn-primary !min-h-9 flex-1 !px-3">{providerBusy?"Saving…":providerConfigured?"Replace key":"Save key"}</button>
              {providerSource==="workspace"?<button type="button" disabled={providerBusy} onClick={()=>void removeProviderKey()} className="btn-danger !min-h-9 !px-3" aria-label="Remove SuperSend API key"><Trash2 className="h-3.5 w-3.5"/></button>:null}
            </div>
          </div> : <p className="text-[12px] leading-4 text-[var(--muted)]">Owner access is required to manage the provider key.</p>}

          {providerMessage?<p className="mt-2 text-[12px] font-bold text-[var(--muted)]">{providerMessage}</p>:null}
          <p className="mt-3 text-[11px] leading-4 text-[var(--muted)]">Stored encrypted. The full key is never shown again after saving. Campaign sending does not depend on this key.</p>
        </div>
      </section>

      <section className="premium-panel overflow-hidden">
        <div className="section-header"><div><p className="page-eyebrow">How it works</p><h2 className="section-title mt-1">Current validator</h2></div><ShieldCheck className="h-5 w-5 text-violet-600"/></div>
        <div className="divide-y divide-[var(--border)]">
          {[
            ["Method","Each job keeps the validation mode selected when it was created: NexiMail internal, Smart hybrid, or SuperSend primary."],
            ["Positive","A positive result means the selected validator accepted the address at validation time. It does not guarantee inbox placement."],
            ["Invalid","Only explicit mailbox-missing or invalid-domain responses become invalid. NexiMail adds an invalid suppression."],
            ["Unknown / Error","Temporary, policy, risky or ambiguous result. In Smart hybrid mode, NexiMail asks SuperSend only when the internal result is unresolved."],
          ].map(([title,body])=><div key={title} className="px-4 py-3"><p className="text-[11px] font-black">{title}</p><p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">{body}</p></div>)}
        </div>
      </section>
    </aside>
  </div>;
}
