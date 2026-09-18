"use client";

import { AlertTriangle, CheckCircle2, FileUp, Loader2, Table2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { analyzeCsvSample, IMPORT_FIELDS } from "@/lib/csv-import";

type ListOption = { id: string; name: string };
type Mapping = Record<string, string>;
const fieldClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-violet-400 dark:border-zinc-800 dark:bg-zinc-900";
const MAX_FILE_BYTES = 300 * 1024 * 1024;

function uploadFile(url: string, file: File, onProgress: (value: number) => void) {
  return new Promise<{ bytes?: number }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "text/csv");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
    };
    xhr.onerror = () => reject(new Error("CSV upload could not reach the server. Check the connection and retry."));
    xhr.onabort = () => reject(new Error("CSV upload was cancelled before completion."));
    xhr.ontimeout = () => reject(new Error("CSV upload timed out before the server finished receiving it."));
    xhr.onload = () => {
      let data: { error?: string; bytes?: number } = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch {}
      if (xhr.status < 200 || xhr.status >= 300) {
        const fallback = xhr.status === 413
          ? "The server or reverse proxy rejected this CSV as too large. NexiMail supports up to 300 MB, but the web proxy upload limit may need to be increased."
          : xhr.status === 401 ? "Your login session expired. Sign in again and retry the import."
          : xhr.status === 403 ? "You do not have permission to upload this CSV."
          : `CSV upload failed with HTTP ${xhr.status || "network error"}.`;
        reject(new Error(data.error || fallback)); return;
      }
      onProgress(100);
      resolve(data);
    };
    xhr.send(file);
  });
}

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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [formatErrors, setFormatErrors] = useState<string[]>([]);
  const [formatWarnings, setFormatWarnings] = useState<string[]>([]);
  const [delimiter, setDelimiter] = useState<"comma"|"semicolon"|"tab"|"unknown">("unknown");

  async function choose(next: File | null) {
    setFile(next); setMessage(""); setUploadProgress(null);
    if (!next) { setHeaders([]); setPreview([]); setMapping({}); setFormatErrors([]); setFormatWarnings([]); setDelimiter("unknown"); return; }
    if (next.size > MAX_FILE_BYTES) { setFile(null); setMessage("CSV is larger than 300 MB."); setFormatErrors(["Maximum upload size is 300 MB."]); return; }
    if (!next.name.toLowerCase().endsWith(".csv")) { setFile(null); setMessage("Choose a .csv file."); setFormatErrors(["NexiMail accepts comma-separated .csv files only."]); return; }
    try {
      const sample = await next.slice(0, Math.min(next.size, 256 * 1024)).text();
      const analysis = analyzeCsvSample(sample);
      setHeaders(analysis.headers);
      setPreview(analysis.preview);
      setMapping(analysis.mapping);
      setFormatErrors(analysis.errors);
      setFormatWarnings(analysis.warnings);
      setDelimiter(analysis.delimiter);
      if (analysis.errors.length) setMessage("CSV format needs attention before upload.");
    } catch {
      setFormatErrors(["Could not read the CSV preview. Re-export the file as UTF-8 comma-separated CSV."]);
      setHeaders([]); setPreview([]); setMapping({});
    }
  }

  const mappedCount = useMemo(() => Object.values(mapping).filter(Boolean).length, [mapping]);

  async function submit() {
    if (!file) return setMessage("Choose a CSV first.");
    if (formatErrors.length) return setMessage("Fix the CSV format issues shown below before uploading.");
    if (!mapping.email) return setMessage("Map the email column.");
    if (!consentSource.trim()) return setMessage("Consent source is required.");
    setBusy(true); setMessage(""); setUploadProgress(0);
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          sizeBytes: file.size,
          headers,
          mapping,
          consentSource: consentSource.trim(),
          consentStatus,
          defaultSource: defaultSource.trim(),
          defaultCategory: defaultCategory.trim(),
          defaultTags: defaultTags.trim(),
          listId,
          queueValidation,
        }),
      });
      const data = await response.json() as { error?: string; jobId?: string; uploadUrl?: string };
      if (!response.ok || !data.uploadUrl || !data.jobId) throw new Error(data.error || "Import could not be initialized.");

      const uploaded = await uploadFile(data.uploadUrl, file, setUploadProgress);
      setMessage(`Upload complete${uploaded.bytes ? ` · ${(uploaded.bytes / 1024 / 1024).toFixed(1)} MB` : ""}. Background processing now shows live rows, speed and ETA below.`);
      setFile(null); setHeaders([]); setPreview([]); setMapping({});
      router.refresh();
    } catch (error) {
      setUploadProgress(null);
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally { setBusy(false); }
  }

  return <section className="premium-panel mb-5 overflow-hidden">
    <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Start an import</p><h2 className="mt-1 text-lg font-black">Upload CSV audience</h2><p className="mt-1 text-xs text-[var(--muted)]">Up to 1,000,000 data rows in one job. Large files stream to persistent disk instead of being loaded into app memory.</p></div>
    <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_.9fr] sm:p-6">
      <div className="space-y-4">
        <label className="grid min-h-36 cursor-pointer place-items-center rounded-2xl border border-dashed border-violet-300 bg-violet-500/[.04] p-6 text-center"><div><UploadCloud className="mx-auto h-8 w-8 text-violet-500"/><p className="mt-3 font-black">{file ? file.name : "Choose CSV"}</p><p className="mt-1 text-xs text-[var(--muted)]">Up to 300 MB · up to 1,000,000 rows · streamed background processing</p></div><input type="file" accept=".csv,text/csv" className="hidden" onChange={(e)=>void choose(e.target.files?.[0] || null)} /></label>
        {uploadProgress !== null ? <div className="rounded-2xl border border-[var(--border)] p-4"><div className="mb-2 flex items-center justify-between text-xs font-black"><span>Upload progress</span><span>{uploadProgress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[var(--surface-soft)]"><div className="h-full rounded-full bg-violet-500 transition-[width] duration-200" style={{ width: `${uploadProgress}%` }}/></div></div> : null}
        {headers.length ? <div className="rounded-2xl border border-[var(--border)] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-black">Column mapping</h3><span className="text-xs font-bold text-violet-500">{mappedCount} mapped</span></div><div className="grid gap-3 sm:grid-cols-2">{IMPORT_FIELDS.map((field)=><label key={field}><span className="mb-1 block text-xs font-bold capitalize">{field.replaceAll("_"," ")}{field === "email" ? " *" : ""}</span><select className={fieldClass} value={mapping[field] || ""} onChange={(e)=>setMapping((m)=>({...m,[field]:e.target.value}))}><option value="">Not mapped</option>{headers.map((h)=><option key={h} value={h}>{h}</option>)}</select></label>)}</div></div> : null}
      </div>
      <div className="space-y-3">
        <label><span className="mb-1 block text-xs font-bold">Consent source *</span><input className={fieldClass} value={consentSource} onChange={(e)=>setConsentSource(e.target.value)} placeholder="website opt-in / customer list / event registration" /></label>
        <div className="grid grid-cols-2 gap-3"><label><span className="mb-1 block text-xs font-bold">Consent status</span><select className={fieldClass} value={consentStatus} onChange={(e)=>setConsentStatus(e.target.value)}><option value="unconfirmed">Unconfirmed</option><option value="confirmed">Confirmed opt-in</option></select></label><label><span className="mb-1 block text-xs font-bold">Default source</span><input className={fieldClass} value={defaultSource} onChange={(e)=>setDefaultSource(e.target.value)} /></label></div>
        <label><span className="mb-1 block text-xs font-bold">Optional list</span><select className={fieldClass} value={listId} onChange={(e)=>setListId(e.target.value)}><option value="">Create no extra assignment</option>{lists.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-bold">Default category</span><input className={fieldClass} value={defaultCategory} onChange={(e)=>setDefaultCategory(e.target.value)} placeholder="Students|NEET" /></label>
        <label><span className="mb-1 block text-xs font-bold">Default tags</span><input className={fieldClass} value={defaultTags} onChange={(e)=>setDefaultTags(e.target.value)} placeholder="neet|medical|raipur" /><span className="mt-1 block text-[11px] text-[var(--muted)]">Use | for multiple tags/categories.</span></label>
        <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-sm font-bold"><input type="checkbox" checked={queueValidation} onChange={(e)=>setQueueValidation(e.target.checked)} /> Queue background validation after import</label>
        {file ? <div className="rounded-xl border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Table2 className="h-4 w-4 text-violet-500"/><span className="text-xs font-black">CSV format check</span></div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${formatErrors.length ? "bg-rose-500/10 text-rose-600" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{formatErrors.length ? "Needs fix" : "Ready"} · {delimiter}</span>
          </div>
          {formatErrors.length ? <div className="mt-3 space-y-1.5">{formatErrors.map((item)=><p key={item} className="flex gap-2 text-[11px] font-bold text-rose-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0"/>{item}</p>)}</div> : <p className="mt-3 flex gap-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5 shrink-0"/>Comma-separated CSV detected and email column recognized.</p>}
          {formatWarnings.length ? <div className="mt-2 space-y-1">{formatWarnings.map((item)=><p key={item} className="text-[11px] font-semibold text-amber-600">{item}</p>)}</div> : null}
        </div> : null}

        {preview.length && headers.length ? <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <div className="bg-[var(--surface-soft)] px-3 py-2 text-xs font-black">Preview · first {preview.length} rows</div>
          <div className="max-h-64 overflow-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[var(--surface)]"><tr>{headers.slice(0,8).map((header)=><th key={header} className="whitespace-nowrap border-b border-r border-[var(--border)] px-3 py-2 font-black">{header || "(blank)"}</th>)}</tr></thead>
              <tbody>{preview.map((row,i)=><tr key={i} className="border-t border-[var(--border)]">{headers.slice(0,8).map((header,j)=><td key={`${header}-${j}`} className="max-w-48 truncate border-r border-[var(--border)] px-3 py-2 text-[var(--muted)]" title={row[j] || ""}>{row[j] || "—"}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {headers.length>8?<p className="border-t border-[var(--border)] px-3 py-2 text-[10px] text-[var(--muted)]">Showing first 8 of {headers.length} columns. All columns will still be imported/mapped.</p>:null}
        </div> : null}
        {message ? <p className="rounded-xl bg-violet-500/[.08] px-3 py-2 text-xs font-bold text-violet-600 dark:text-violet-300">{message}</p> : null}
        <button disabled={busy || !file || !!formatErrors.length || !mapping.email || !consentSource.trim()} onClick={()=>void submit()} className="btn-primary w-full">{busy ? <><Loader2 className="h-4 w-4 animate-spin"/> {uploadProgress && uploadProgress > 0 ? `Uploading ${uploadProgress}%` : "Preparing upload…"}</> : <><FileUp className="h-4 w-4"/> Queue import</>}</button>
      </div>
    </div>
  </section>;
}
