"use client";

import { KeyRound, Pause, Play, RotateCcw, SearchCheck, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ImportOption = { id: string; filename: string; unresolved: number };

export function ValidationControls({
  paused,
  activeJob,
  unresolved,
  imports,
}: {
  paused: boolean;
  activeJob: { id: string; scope: string; status: string; processedRows: number; totalRows: number } | null;
  unresolved: number;
  imports: ImportOption[];
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

  async function loadProvider() {
    try {
      const response = await fetch("/api/validation/provider", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as {
        configured?: boolean;
        hint?: string | null;
        source?: "workspace" | "environment" | null;
        canManage?: boolean;
      };
      if (!response.ok) return;
      setProviderConfigured(Boolean(data.configured));
      setProviderHint(data.hint || null);
      setProviderSource(data.source || null);
      setProviderManage(Boolean(data.canManage));
    } catch {}
  }

  useEffect(() => { void loadProvider(); }, []);

  async function saveProviderKey() {
    if (!providerKey.trim()) { setProviderMessage("Enter a Supersend API key."); return; }
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
      setProviderMessage("Supersend API key saved securely.");
    } catch {
      setProviderMessage("Could not reach NexiMail.");
    } finally { setProviderBusy(false); }
  }

  async function removeProviderKey() {
    if (!window.confirm("Remove the workspace Supersend API key?")) return;
    setProviderBusy(true); setProviderMessage("");
    try {
      const response = await fetch("/api/validation/provider", { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { error?: string; configured?: boolean; source?: "environment" | null };
      if (!response.ok) { setProviderMessage(data.error || "Could not remove API key."); return; }
      setProviderConfigured(Boolean(data.configured));
      setProviderSource(data.source || null);
      setProviderHint(data.configured ? "Environment key" : null);
      setProviderMessage(data.configured ? "Workspace key removed. Environment fallback is still active." : "Supersend API key removed.");
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
          <p className="section-subtitle">Internal syntax, MX and SMTP recipient checks across email domains. Supersend is optional.</p>
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
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-500"/><b className="text-xs">Active validation job</b><span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-black uppercase text-blue-700 dark:text-blue-300">{paused ? "paused" : activeJob.status}</span></div><div className="mt-1 truncate font-mono text-[11px] text-[var(--muted)]">{activeJob.scope} · {activeJob.id.slice(0,8)}</div></div>
          <div className="text-right text-[11px] font-bold text-[var(--muted)]">{activeJob.processedRows.toLocaleString()} / {activeJob.totalRows.toLocaleString()}</div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-violet-500 transition-all" style={{width:(activeJob.totalRows ? Math.min(100, activeJob.processedRows / activeJob.totalRows * 100) : 0) + "%"}}/></div>
      </div> : null}

      <div className="grid gap-3 p-4 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5">
          <div className="mb-3 flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300"><SearchCheck className="h-4 w-4"/></div><div><h3 className="text-[12px] font-black">Validate one contact</h3><p className="mt-0.5 text-[12px] leading-4 text-[var(--muted)]">Existing contact with Pending, Unknown or Error status.</p></div></div>
          <div className="flex gap-2"><input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" placeholder="person@example.com" className="form-control min-w-0 flex-1"/><button type="button" disabled={busy || !!activeJob || !email.trim() || !validationReady} onClick={()=>act("start_single")} className="btn-secondary !min-h-10 shrink-0 !px-3">Validate</button></div>
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
        <div className="section-header"><div><p className="page-eyebrow">Provider</p><h2 className="section-title mt-1">Supersend API key</h2></div><KeyRound className="h-5 w-5 text-violet-600"/></div>
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5">
            <div><p className="text-[11px] font-bold text-[var(--muted)]">Status</p><p className="mt-0.5 text-[11.5px] font-black">{providerConfigured===null?"Checking…":providerConfigured?"Configured":"Not configured"}</p></div>
            <span className={`rounded-full px-2 py-1 text-[11px] font-black uppercase ${providerConfigured?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":"bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{providerConfigured ? (providerSource==="workspace"?"Workspace":"Environment") : "Optional"}</span>
          </div>

          {providerConfigured && providerHint ? <p className="mb-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2 font-mono text-[12px] text-[var(--muted)]">Saved key: {providerHint}</p> : null}

          {providerManage ? <div className="space-y-2">
            <input type="password" autoComplete="new-password" value={providerKey} onChange={(e)=>setProviderKey(e.target.value)} placeholder={providerConfigured?"Paste a new key to replace current":"Paste Supersend API key"} className="form-control"/>
            <div className="flex gap-2">
              <button type="button" disabled={providerBusy || !providerKey.trim()} onClick={()=>void saveProviderKey()} className="btn-primary !min-h-9 flex-1 !px-3">{providerBusy?"Saving…":providerConfigured?"Replace key":"Save key"}</button>
              {providerSource==="workspace"?<button type="button" disabled={providerBusy} onClick={()=>void removeProviderKey()} className="btn-danger !min-h-9 !px-3" aria-label="Remove Supersend API key"><Trash2 className="h-3.5 w-3.5"/></button>:null}
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
            ["Method","NexiMail performs syntax, MX and SMTP RCPT checks directly. Supersend can be enabled as an optional fallback."],
            ["Positive","The recipient MX accepted the mailbox probe, or the optional fallback returned a positive verdict. Inbox placement is separate."],
            ["Invalid","Only explicit mailbox-missing or invalid-domain responses become invalid. NexiMail adds an invalid suppression."],
            ["Unknown / Error","Temporary, provider or ambiguous result. Contact remains send-eligible and can be checked again."],
          ].map(([title,body])=><div key={title} className="px-4 py-3"><p className="text-[11px] font-black">{title}</p><p className="mt-1 text-[12px] leading-4 text-[var(--muted)]">{body}</p></div>)}
        </div>
      </section>
    </aside>
  </div>;
}
