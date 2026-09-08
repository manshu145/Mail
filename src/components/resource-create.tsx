"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Field = { name: string; label: string; type?: "text" | "email" | "number" | "textarea" | "select"; required?: boolean; placeholder?: string; options?: { label: string; value: string }[] };

export function ResourceCreate({ endpoint, title, buttonLabel, fields, disabled = false }: { endpoint: string; title: string; buttonLabel: string; fields: Field[]; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setBusy(true); setError("");
    const body = Object.fromEntries(formData.entries());
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error || "Could not save."); return; }
    setOpen(false); router.refresh();
  }

  return <>
    <button disabled={disabled} className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {buttonLabel}</button>
    {open ? <div className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <section className="premium-panel w-full max-w-lg p-6">
        <div className="mb-6 flex items-start justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">NexiMail</p><h2 className="mt-1 text-2xl font-black tracking-tight">{title}</h2></div><button className="btn-secondary !min-h-0 !p-2" onClick={() => setOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button></div>
        <form action={submit} className="space-y-4">
          {fields.map((field) => <label className="block" key={field.name}><span className="mb-1.5 block text-sm font-bold">{field.label}</span>{field.type === "textarea" ? <textarea name={field.name} required={field.required} placeholder={field.placeholder} rows={5} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900" /> : field.type === "select" ? <select name={field.name} required={field.required} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none dark:border-zinc-800 dark:bg-zinc-900">{field.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : <input name={field.name} required={field.required} placeholder={field.placeholder} type={field.type || "text"} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900" />}</label>)}
          {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}
          <button disabled={busy} className="btn-primary w-full">{busy ? "Saving…" : buttonLabel}</button>
        </form>
      </section>
    </div> : null}
  </>;
}
