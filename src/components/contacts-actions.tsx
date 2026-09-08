"use client";

import { FileUp, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Result = { imported?: number; duplicates?: number; invalid?: number; error?: string };

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

export function ContactsActions({ databaseConfigured }: { databaseConfigured: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submitContact(formData: FormData) {
    setBusy(true); setMessage("");
    const response = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "single", contact: { email: formData.get("email"), firstName: formData.get("firstName"), lastName: formData.get("lastName") } }),
    });
    const data = await response.json() as Result;
    setBusy(false);
    if (!response.ok) { setMessage(data.error || "Could not add contact."); return; }
    setOpen(false); router.refresh();
  }

  async function importFile(file: File) {
    setBusy(true); setMessage("");
    try {
      const matrix = parseCsv(await file.text());
      if (!matrix.length) throw new Error("CSV is empty.");
      const headers = matrix[0].map((v) => v.trim().toLowerCase().replace(/[ _-]/g, ""));
      const emailIndex = headers.findIndex((v) => ["email", "emailaddress"].includes(v));
      const firstIndex = headers.findIndex((v) => ["firstname", "first"].includes(v));
      const lastIndex = headers.findIndex((v) => ["lastname", "last"].includes(v));
      if (emailIndex < 0) throw new Error("CSV must include an email column.");
      const rows = matrix.slice(1, 1001).map((r) => ({ email: r[emailIndex] || "", firstName: firstIndex >= 0 ? r[firstIndex] : "", lastName: lastIndex >= 0 ? r[lastIndex] : "" }));
      const response = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "bulk", filename: file.name, rows }) });
      const data = await response.json() as Result;
      if (!response.ok) throw new Error(data.error || "Import failed.");
      setMessage(`Imported ${data.imported ?? 0} · duplicates ${data.duplicates ?? 0} · invalid ${data.invalid ?? 0}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} className="hidden" type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && importFile(event.target.files[0])} />
        <button disabled={!databaseConfigured || busy} onClick={() => fileRef.current?.click()} className="btn-secondary"><FileUp className="h-4 w-4" /> Import CSV</button>
        <button disabled={!databaseConfigured} onClick={() => setOpen(true)} className="btn-primary"><Plus className="h-4 w-4" /> Add contact</button>
      </div>
      {message ? <p className="mt-3 text-right text-xs font-semibold text-zinc-500">{message}</p> : null}
      {open ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
          <section className="premium-panel w-full max-w-md p-6">
            <div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">Audience</p><h2 className="mt-1 text-2xl font-black tracking-tight">Add contact</h2></div><button aria-label="Close" onClick={() => setOpen(false)} className="btn-secondary !min-h-0 !p-2"><X className="h-5 w-5" /></button></div>
            <form action={submitContact} className="space-y-4">
              <label className="block"><span className="mb-1.5 block text-sm font-bold">Email</span><input required name="email" type="email" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900" placeholder="name@company.com" /></label>
              <div className="grid grid-cols-2 gap-3"><label><span className="mb-1.5 block text-sm font-bold">First name</span><input name="firstName" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900" /></label><label><span className="mb-1.5 block text-sm font-bold">Last name</span><input name="lastName" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900" /></label></div>
              {message ? <p className="text-sm font-semibold text-rose-600">{message}</p> : null}
              <button disabled={busy} className="btn-primary w-full">{busy ? "Saving…" : "Save contact"}</button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
