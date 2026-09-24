"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, Loader2, MoreHorizontal, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useState } from "react";

export function UiTester() {
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);

  function simulateLoading() {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1100);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  return (
    <div className="space-y-5">
      {toast ? <div role="status" className="ui-toast fixed bottom-5 right-5 z-[100] flex max-w-[min(92vw,380px)] items-start gap-3 p-4 reveal"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--success)]" /><div className="min-w-0 flex-1"><p className="text-sm font-black">UI feedback</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{toast}</p></div><button className="icon-button grid h-7 w-7" onClick={() => setToast(null)} aria-label="Dismiss notification"><X className="h-3.5 w-3.5" /></button></div> : null}

      <div className="page-intro">
        <div>
          <div className="mb-2 flex items-center gap-2"><p className="page-eyebrow">Owner only · Frontend QA</p><span className="status-pill"><Sparkles className="h-3 w-3" /> Interaction lab</span></div>
          <h1 className="page-title">NexiMail UI Tester</h1>
          <p className="page-description">A safe visual and interaction checklist for layout, states, responsiveness, loading, errors, tables and motion. It does not call delivery APIs or modify backend state.</p>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={() => setError(v => !v)}><AlertTriangle className="h-4 w-4" /> Toggle error</button>
          <button className="btn-primary" onClick={() => showToast("Toast, focus states and dismissal are working.")}><CheckCircle2 className="h-4 w-4" /> Test feedback</button>
        </div>
      </div>

      {error ? <div role="alert" className="ui-error-panel rounded-2xl p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-rose-500" /><div><p className="text-sm font-black">Example error state</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Errors are presented as actionable states instead of raw exceptions or empty screens.</p></div><button className="ml-auto icon-button grid h-8 w-8" onClick={() => setError(false)} aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button></div></div> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["Responsive","Desktop → mobile","Cards collapse cleanly"],["Motion","Reduced-motion aware","Short, purposeful transitions"],["Errors","Actionable states","No raw stack traces"],["Loading","Skeleton + progress","No layout jumps"]].map(([label,value,note]) => <article key={label} className="metric-card surface-lift p-5"><p className="text-[10px] font-black uppercase tracking-[.13em] text-[var(--muted)]">{label}</p><p className="mt-2 text-xl font-black">{value}</p><p className="mt-2 text-xs leading-5 text-[var(--muted)]">{note}</p></article>)}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <article className="section-card overflow-hidden">
          <div className="section-card-header"><div><p className="page-eyebrow">Controls</p><h2 className="section-card-title mt-1">Forms & interaction</h2><p className="section-card-copy">Keyboard focus, disabled states, validation messaging and touch targets.</p></div><MoreHorizontal className="h-5 w-5 text-[var(--muted)]" /></div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label className="block"><span className="mb-2 block text-xs font-black">Search</span><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" /><input className="form-control pl-10" placeholder="Try keyboard navigation" /></div></label>
            <label className="block"><span className="mb-2 block text-xs font-black">Select</span><select className="form-control"><option>Healthy</option><option>Needs attention</option><option>Paused</option></select></label>
            <label className="block sm:col-span-2"><span className="mb-2 block text-xs font-black">Long content</span><textarea className="form-control min-h-28 resize-y" placeholder="Resize this field on desktop and mobile." /></label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button className="btn-primary" onClick={simulateLoading} disabled={loading}>{loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Working…</> : <><RefreshCw className="h-4 w-4" /> Simulate loading</>}</button>
              <button className="btn-secondary" onClick={() => setOpen(true)}><CircleHelp className="h-4 w-4" /> Open modal</button>
              <button className="btn-secondary" disabled>Disabled action</button>
            </div>
          </div>
        </article>

        <article className="section-card p-5">
          <p className="page-eyebrow">States</p>
          <h2 className="section-card-title mt-1">Empty & status treatment</h2>
          <div className="mt-4 ui-empty min-h-0">
            <div><div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><Search className="h-5 w-5" /></div><p className="mt-3 text-sm font-black">Nothing to show</p><p className="mt-1 text-xs text-[var(--muted)]">Empty states explain what happened and what to do next.</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><span className="status-pill"><span className="live-dot" />Healthy</span><span className="status-pill">Queued</span><span className="status-pill">Needs review</span></div>
        </article>
      </section>

      <section className="section-card overflow-hidden">
        <div className="section-card-header"><div><p className="page-eyebrow">Data density</p><h2 className="section-card-title mt-1">Readable logs</h2><p className="section-card-copy">Long IDs, provider responses and timestamps stay scannable without dumping raw payloads.</p></div></div>
        <div className="desktop-table-only overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead><tr><th>Recipient</th><th>Stage</th><th>Status</th><th>Last response</th><th>Updated</th></tr></thead><tbody>{[["alex@example.com","SMTP accepted","Delivered","250 2.0.0 accepted","2 min ago"],["maya@example.com","Provider response","Deferred","421 temporary rate limit","4 min ago"],["invalid@","Validation","Suppressed","Invalid recipient format","7 min ago"]].map((row) => <tr key={row[0]} className="interactive-row border-t border-[var(--border)]"><td className="px-4 py-4 font-bold">{row[0]}</td><td className="text-xs font-bold">{row[1]}</td><td><span className="status-pill">{row[2]}</span></td><td className="max-w-[320px] truncate font-mono text-[11px] text-[var(--muted)]">{row[3]}</td><td className="text-xs text-[var(--muted)]">{row[4]}</td></tr>)}</tbody></table></div>
        <div className="mobile-card-list p-3">{[["alex@example.com","SMTP accepted","Delivered"],["maya@example.com","Provider response","Deferred"],["invalid@","Validation","Suppressed"]].map((row) => <article key={row[0]} className="panel-soft p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black">{row[0]}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{row[1]}</p></div><span className="status-pill">{row[2]}</span></div></article>)}</div>
      </section>

      {open ? <div className="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="UI tester modal">
        <div className="w-full max-w-lg rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lift)] reveal">
          <div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">Modal</p><h2 className="mt-1 text-xl font-black">Viewport-safe dialog</h2><p className="mt-2 text-xs leading-5 text-[var(--muted)]">This verifies overlays remain attached to the viewport and do not get trapped by page entrance transforms.</p></div><button className="icon-button grid" onClick={() => setOpen(false)} aria-label="Close modal"><X className="h-4 w-4" /></button></div>
          <div className="mt-5 rounded-2xl bg-[var(--surface-soft)] p-4 text-xs leading-5 text-[var(--muted)]">Try resizing the browser while this is open. The dialog should remain centered and the page underneath should not jump.</div>
          <div className="mt-5 flex justify-end"><button className="btn-primary" onClick={() => setOpen(false)}>Close</button></div>
        </div>
      </div> : null}
    </div>
  );
}
