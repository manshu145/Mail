"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportJobActions({ id, deletable }: { id: string; deletable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!deletable || busy) return;
    if (!window.confirm("Delete this import history and its stored report data? Contacts already imported will stay in NexiMail.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/imports/${id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Delete failed.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally { setBusy(false); }
  }

  return <div className="flex flex-wrap items-center gap-2">
    <a className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-bold hover:bg-[var(--surface-soft)]" href={`/api/imports/${id}/report`}>Report CSV</a>
    {deletable ? <button type="button" onClick={remove} disabled={busy} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11px] font-bold text-rose-600 disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-300">{busy ? "Deleting…" : "Delete"}</button> : null}
    {error ? <span className="basis-full text-[10px] text-rose-500">{error}</span> : null}
  </div>;
}
