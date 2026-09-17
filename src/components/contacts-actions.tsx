"use client";

import { FileUp, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Result = { queued?: boolean; total?: number; jobId?: string; error?: string };
type ConsentStatus = "confirmed" | "unconfirmed";

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) { const char = text[i]; if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; } else if (char === "," && !quoted) { row.push(cell); cell = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((v) => v.trim())) rows.push(row); row = []; } else cell += char; }
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row); return rows;
}

const fieldClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900";

export function ContactsActions({ databaseConfigured }: { databaseConfigured: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importConsentSource, setImportConsentSource] = useState("");
  const [importConsentStatus, setImportConsentStatus] = useState<ConsentStatus>("unconfirmed");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submitContact(formData: FormData) {
    setBusy(true); setMessage("");
    const consentStatus = String(formData.get("consentStatus") || "unconfirmed") as ConsentStatus;
    const consentSource = String(formData.get("consentSource") || "").trim();
    if (consentStatus === "confirmed" && !consentSource) { setBusy(false); setMessage("Consent source is required for a confirmed opt-in."); return; }
    const response = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "single", contact: { email: formData.get("email"), firstName: formData.get("firstName"), lastName: formData.get("lastName"), consentStatus, consentSource } }) });
    const data = await response.json() as Result; setBusy(false); if (!response.ok) { setMessage(data.error || "Could not add contact."); return; } setOpen(false); router.refresh();
  }

  function chooseImport(file: File) {
    setSelectedFile(file); setImportConsentSource(""); setImportConsentStatus("unconfirmed"); setMessage(""); setImportOpen(true);
  }

  async function importFile() {
    const file = selectedFile;
    if (!file) return;
    const consentSource = importConsentSource.trim();
    if (!consentSource) { setMessage("Opt-in / consent source is required for every import."); return; }
    setBusy(true); setMessage("");
    try {
      const matrix = parseCsv(await file.text()); if (!matrix.length) throw new Error("CSV is empty.");
      const headers = matrix[0].map((v) => v.trim().toLowerCase().replace(/[ _-]/g, ""));
      const emailIndex = headers.findIndex((v) => ["email", "emailaddress"].includes(v));
      const firstIndex = headers.findIndex((v) => ["firstname", "first"].includes(v));
      const lastIndex = headers.findIndex((v) => ["lastname", "last"].includes(v));
      const sourceIndex = headers.findIndex((v) => ["consentsource", "optinsource", "optinsource", "permission source".replace(/ /g, "")].includes(v));
      const statusIndex = headers.findIndex((v) => ["consentstatus", "optinstatus"].includes(v));
      if (emailIndex < 0) throw new Error("CSV must include an email column.");
      if (matrix.length - 1 > 5000) throw new Error("This importer queues up to 5,000 rows per job. Split larger CSV files before upload.");
      const rows = matrix.slice(1).map((r) => {
        const rowStatus = String(statusIndex >= 0 ? r[statusIndex] || "" : "").trim().toLowerCase();
        return {
          email: r[emailIndex] || "",
          firstName: firstIndex >= 0 ? r[firstIndex] : "",
          lastName: lastIndex >= 0 ? r[lastIndex] : "",
          consentStatus: rowStatus === "confirmed" ? "confirmed" : importConsentStatus,
          consentSource: (sourceIndex >= 0 ? r[sourceIndex] : "")?.trim() || consentSource,
        };
      });
      const response = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "bulk", filename: file.name, rows }) });
      const data = await response.json() as Result; if (!response.ok) throw new Error(data.error || "Import failed.");
      setMessage(`Queued ${data.total ?? rows.length} rows with consent source · background import worker will process them safely.`);
      setImportOpen(false); setSelectedFile(null); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  return <>
    <div className="flex flex-wrap items-center gap-2">
      <input ref={fileRef} className="hidden" type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && chooseImport(event.target.files[0])} />
      <button disabled={!databaseConfigured || busy} onClick={() => fileRef.current?.click()} className="btn-secondary"><FileUp className="h-4 w-4" /> Import CSV</button>
      <button disabled={!databaseConfigured} onClick={() => setOpen(true)} className="btn-primary"><Plus className="h-4 w-4" /> Add contact</button>
    </div>
    {message ? <p className="mt-3 text-right text-xs font-semibold text-zinc-500">{message}</p> : null}

    {importOpen ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"><section className="premium-panel w-full max-w-lg p-6">
      <div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">Audience import</p><h2 className="mt-1 text-2xl font-black tracking-tight">Import contacts</h2><p className="mt-1 text-xs text-zinc-500">{selectedFile?.name}</p></div><button aria-label="Close" onClick={() => setImportOpen(false)} className="btn-secondary !min-h-0 !p-2"><X className="h-5 w-5" /></button></div>
      <div className="space-y-4">
        <label className="block"><span className="mb-1.5 block text-sm font-bold">Opt-in / consent source <b className="text-rose-500">*</b></span><input value={importConsentSource} onChange={(e)=>setImportConsentSource(e.target.value)} className={fieldClass} placeholder="Website signup / customer opt-in / event registration"/><span className="mt-1.5 block text-xs text-zinc-500">Stored on every imported contact unless a row has its own consent_source / optin_source column.</span></label>
        <label className="block"><span className="mb-1.5 block text-sm font-bold">Consent status</span><select value={importConsentStatus} onChange={(e)=>setImportConsentStatus(e.target.value as ConsentStatus)} className={fieldClass}><option value="unconfirmed">Unconfirmed</option><option value="confirmed">Confirmed opt-in</option></select></label>
        {message ? <p className="text-sm font-semibold text-rose-600">{message}</p> : null}
        <button disabled={busy || !importConsentSource.trim()} onClick={importFile} className="btn-primary w-full">{busy ? "Queueing import…" : "Queue import"}</button>
      </div>
    </section></div> : null}

    {open ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"><section className="premium-panel w-full max-w-md p-6"><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">Audience</p><h2 className="mt-1 text-2xl font-black tracking-tight">Add contact</h2></div><button aria-label="Close" onClick={() => setOpen(false)} className="btn-secondary !min-h-0 !p-2"><X className="h-5 w-5" /></button></div><form action={submitContact} className="space-y-4"><label className="block"><span className="mb-1.5 block text-sm font-bold">Email</span><input required name="email" type="email" className={fieldClass} placeholder="name@company.com" /></label><div className="grid grid-cols-2 gap-3"><label><span className="mb-1.5 block text-sm font-bold">First name</span><input name="firstName" className={fieldClass} /></label><label><span className="mb-1.5 block text-sm font-bold">Last name</span><input name="lastName" className={fieldClass} /></label></div><label className="block"><span className="mb-1.5 block text-sm font-bold">Consent status</span><select name="consentStatus" defaultValue="unconfirmed" className={fieldClass}><option value="unconfirmed">Unconfirmed</option><option value="confirmed">Confirmed opt-in</option></select></label><label className="block"><span className="mb-1.5 block text-sm font-bold">Consent source</span><input name="consentSource" className={fieldClass} placeholder="Website signup / customer opt-in"/></label>{message ? <p className="text-sm font-semibold text-rose-600">{message}</p> : null}<button disabled={busy} className="btn-primary w-full">{busy ? "Saving…" : "Save contact"}</button></form></section></div> : null}
  </>;
}
