"use client";

import { Pause, Play, RotateCcw, SearchCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
      if (action === "pause") setNotice("Validation paused after the current mailbox check.");
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

  return <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
    <section className="premium-panel p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="page-eyebrow">Validation control</p>
          <h2 className="mt-1 text-lg font-black">Gmail mailbox checks</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">Only unresolved Gmail / Googlemail contacts are queued. Final Accepted / Valid / Invalid results are not rechecked automatically.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {paused
            ? <button disabled={busy} type="button" onClick={() => act("resume")} className="btn-primary"><Play className="h-4 w-4"/> Resume</button>
            : <button disabled={busy} type="button" onClick={() => act("pause")} className="btn-secondary"><Pause className="h-4 w-4"/> Pause</button>}
          <button disabled={busy || !!activeJob || unresolved === 0} type="button" onClick={() => act("start_pending")} className="btn-primary"><RotateCcw className="h-4 w-4"/> Validate unresolved</button>
        </div>
      </div>

      {activeJob ? <div className="mt-4 rounded-2xl border border-blue-500/15 bg-blue-500/[0.05] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><b className="text-sm">Active job</b><div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{activeJob.id}</div></div>
          <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-extrabold capitalize text-blue-700 dark:text-blue-300">{paused ? "paused" : activeJob.status}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-soft)]"><div className="h-full rounded-full bg-violet-500 transition-all" style={{width:(activeJob.totalRows ? Math.min(100, activeJob.processedRows / activeJob.totalRows * 100) : 0) + "%"}}/></div>
        <div className="mt-2 flex justify-between text-[11px] font-bold text-[var(--muted)]"><span>{activeJob.scope}</span><span>{activeJob.processedRows.toLocaleString()} / {activeJob.totalRows.toLocaleString()}</span></div>
      </div> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
          <h3 className="text-sm font-black">Validate one contact</h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">The contact must already exist and have Pending / Unknown / Error status.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={email} onChange={(e)=>setEmail(e.target.value)} type="email" placeholder="person@gmail.com" className="min-w-0 flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none"/>
            <button type="button" disabled={busy || !!activeJob || !email.trim()} onClick={()=>act("start_single")} className="btn-secondary shrink-0"><SearchCheck className="h-4 w-4"/> Validate</button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
          <h3 className="text-sm font-black">Validate a recent CSV import</h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">Only unresolved Gmail contacts from that import are included.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select value={importId} onChange={(e)=>setImportId(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none">
              {imports.length ? imports.map((item)=><option key={item.id} value={item.id}>{item.filename} · {item.unresolved} unresolved</option>) : <option value="">No imports need validation</option>}
            </select>
            <button type="button" disabled={busy || !!activeJob || !importId} onClick={()=>act("start_import")} className="btn-secondary shrink-0">Validate import</button>
          </div>
        </div>
      </div>

      {notice ? <p role="status" className="mt-4 text-xs font-bold text-emerald-700 dark:text-emerald-300">{notice}</p> : null}
      {error ? <p role="alert" className="mt-4 text-xs font-bold text-rose-600">{error}</p> : null}
    </section>

    <aside className="premium-panel p-5">
      <p className="page-eyebrow">How it works</p>
      <h2 className="mt-1 text-lg font-black">Current validator</h2>
      <div className="mt-4 space-y-3 text-sm">
        <div className="rounded-xl border border-[var(--border)] p-3"><b>Method</b><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Direct SMTP RCPT probe against Gmail MX. No third-party validation API is configured in the current production stack.</p></div>
        <div className="rounded-xl border border-[var(--border)] p-3"><b>Accepted</b><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Gmail accepted the mailbox RCPT check. This does not guarantee inbox placement.</p></div>
        <div className="rounded-xl border border-[var(--border)] p-3"><b>Invalid</b><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Explicit mailbox-not-found response. NexiMail adds an invalid suppression.</p></div>
        <div className="rounded-xl border border-[var(--border)] p-3"><b>Unknown / Error</b><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Temporary policy, timeout, network or ambiguous result. These remain eligible for a later retry.</p></div>
      </div>
    </aside>
  </div>;
}
