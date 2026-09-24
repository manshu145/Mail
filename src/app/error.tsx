"use client";

import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui] unhandled route error", error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] p-5">
      <section className="ui-error-panel w-full max-w-xl rounded-[24px] p-6 shadow-[var(--shadow-lift)] sm:p-8">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-300"><AlertTriangle className="h-6 w-6" /></div>
        <p className="page-eyebrow mt-6">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">This workspace screen hit an unexpected error.</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Your data and sending configuration were not changed by this screen error. Try the page again or return to the dashboard.</p>
        {error?.digest ? <p className="mt-4 rounded-xl bg-[var(--surface-soft)] px-3 py-2 font-mono text-[10px] text-[var(--muted)]">Reference: {error.digest}</p> : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => reset()}><RefreshCw className="h-4 w-4" /> Try again</button>
          <a href="/dashboard" className="btn-secondary"><ArrowLeft className="h-4 w-4" /> Dashboard</a>
        </div>
      </section>
    </main>
  );
}
