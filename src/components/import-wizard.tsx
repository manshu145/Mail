"use client";

import { FileUp, Loader2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { detectMapping, IMPORT_FIELDS, parseCsv } from "@/lib/csv-import";

type ListOption = { id: string; name: string };
type Mapping = Record<string, string>;
const fieldClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-violet-400 dark:border-zinc-800 dark:bg-zinc-900";

export function ImportWizard({ lists }: { lists: ListOption[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [consentSource, setConsentSource] = useState("");
  const [consentStatus, setConsentStatus] = useState("unconfirmed");
  const [defaultSource, setDefaultSource] = useState("csv_import");
  const [defaultCategory, setDefaultCategory] = useState("");
  const [defaultTags, setDefaultTags] = useState("");
  const [listId, setListId] = useState("");
  const [queueValidation, setQueueValidation] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function choose(next: File | null) {
    setFile(next); setMessage("");
    if (!next) { setHeaders([]); setPreview([]); setMapping({}); return; }
    if (next.size > 50 * 1024 * 1024) { setMessage("CSV is larger than 50 MB."); return; }
    const sample = await next.slice(0, Math.min(next.size, 256 * 1024)).text();
    const matrix = parseCsv(sample);
    const nextHeaders = (matrix[0] || []).map((v) => v.trim());
    setHeaders(nextHeaders); setPreview(matrix.slice(1, 6)); setMapping(detectMapping(nextHeaders));
  }

  const mappedCount = useMemo(() => Object.values(mapping).filter(Boolean).length, [mapping]);

  async function submit() {
    if (!file) return setMessage("Choose a CSV first.");
    if (!mapping.email) return setMessage("Map the email column.");
    if (!consentSource.trim()) return setMessage("Consent source is required.");
    setBusy(true); setMessage("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("mapping", JSON.stringify(mapping));
      body.set("consentSource", consentSource.trim());
      body.set("consentStatus", consentStatus);
      body.set("defaultSource", defaultSource.trim());
      body.set("defaultCategory", defaultCategory.trim());
      body.set("defaultTags", defaultTags.trim());
      body.set("listId", listId);
      body.set("queueValidation", String(queueValidation));
      const response = await fetch("/api/imports", { method: "POST", body });
      const data = await response.json() as { error?: string; total?: number };
      if (!response.ok) throw new Error(data.error || "Import could not be queued.");
      setMessage(`Queued ${(data.total || 0).toLocaleString()} rows. You can leave this page; the worker continues in background.`);
      setFile(null); setHeaders([]); setPreview([]); setMapping({}); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); }
  }

  return <section className="premium-panel mb-5 overflow-hidden">
    <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Start an import</p><h2 className="mt-1 text-lg font-black">Upload CSV audience</h2><p className="mt-1 text-xs text-[var(--muted)]">The file is stored once, then the import worker processes it independently.</p></div>
    <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_.9fr] sm:p-6">
      <div className="space-y-4">
        <label className="grid min-h-36 cursor-pointer place-items-center rounded-2xl border border-dashed border-violet-300 bg-violet-500/[.04] p-6 text-center"><div><UploadCloud className="mx-auto h-8 w-8 text-violet-500"/><p className="mt-3 font-black">{file ? file.name : "Choose CSV"}</p><p className="mt-1 text-xs text-[var(--muted)]">Up to 50 MB · processing continues in background</p></div><input type="file" accept=".csv,text/csv" className="hidden" onChange={(e)=>void choose(e.target.files?.[0] || null)} /></label>
        {headers.length ? <div className="rounded-2xl border border-[var(--border)] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-black">Column mapping</h3><span className="text-xs font-bold text-violet-500">{mappedCount} mapped</span></div><div className="grid gap-3 sm:grid-cols-2">{IMPORT_FIELDS.map((field)=><label key={field}><span className="mb-1 block text-xs font-bold capitalize">{field.replaceAll("_"," ")}{field === "email" ? " *" : ""}</span><select className={fieldClass} value={mapping[field] || ""} onChange={(e)=>setMapping((m)=>({...m,[field]:e.target.value}))}><option value="">Not mapped</option>{headers.map((h)=><option key={h} value={h}>{h}</option>)}</select></label>)}</div></div> : null}
      </div>
      <div className="space-y-3">
        <label><span className="mb-1 block text-xs font-bold">Consent source *</span><input className={fieldClass} value={consentSource} onChange={(e)=>setConsentSource(e.target.value)} placeholder="website opt-in / customer list / event registration" /></label>
        <div className="grid grid-cols-2 gap-3"><label><span className="mb-1 block text-xs font-bold">Consent status</span><select className={fieldClass} value={consentStatus} onChange={(e)=>setConsentStatus(e.target.value)}><option value="unconfirmed">Unconfirmed</option><option value="confirmed">Confirmed opt-in</option></select></label><label><span className="mb-1 block text-xs font-bold">Default source</span><input className={fieldClass} value={defaultSource} onChange={(e)=>setDefaultSource(e.target.value)} /></label></div>
        <label><span className="mb-1 block text-xs font-bold">Optional list</span><select className={fieldClass} value={listId} onChange={(e)=>setListId(e.target.value)}><option value="">Create no extra assignment</option>{lists.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-bold">Default category</span><input className={fieldClass} value={defaultCategory} onChange={(e)=>setDefaultCategory(e.target.value)} placeholder="Students|NEET" /></label>
        <label><span className="mb-1 block text-xs font-bold">Default tags</span><input className={fieldClass} value={defaultTags} onChange={(e)=>setDefaultTags(e.target.value)} placeholder="neet|medical|raipur" /><span className="mt-1 block text-[11px] text-[var(--muted)]">Use | for multiple tags/categories.</span></label>
        <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm font-bold"><input type="checkbox" checked={queueValidation} onChange={(e)=>setQueueValidation(e.target.checked)} /> Queue background validation after import</label>
        {preview.length ? <div className="overflow-hidden rounded-xl border border-[var(--border)]"><div className="bg-[var(--surface-soft)] px-3 py-2 text-xs font-black">Preview · first {preview.length} rows</div><div className="max-h-36 overflow-auto text-[11px]">{preview.map((row,i)=><div key={i} className="border-t border-[var(--border)] px-3 py-2 text-[var(--muted)]">{row.slice(0,4).join(" · ")}</div>)}</div></div> : null}
        {message ? <p className="rounded-xl bg-violet-500/[.08] px-3 py-2 text-xs font-bold text-violet-600 dark:text-violet-300">{message}</p> : null}
        <button disabled={busy || !file || !mapping.email || !consentSource.trim()} onClick={()=>void submit()} className="btn-primary w-full">{busy ? <><Loader2 className="h-4 w-4 animate-spin"/> Uploading…</> : <><FileUp className="h-4 w-4"/> Queue import</>}</button>
      </div>
    </div>
  </section>;
}
