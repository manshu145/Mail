"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";

export function SegmentCreate({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState("email_domain");

  async function create(formData: FormData) {
    setBusy(true); setError("");
    const response = await fetch("/api/segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: formData.get("name"), description: formData.get("description"), field: formData.get("field"), attributeKey: formData.get("attributeKey"), operator: formData.get("operator"), value: formData.get("value") }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error || "Could not create segment."); return; }
    setOpen(false); setField("email_domain"); router.refresh();
  }

  return <>
    <button disabled={disabled} onClick={() => setOpen(true)} className="btn-primary"><Plus className="h-4 w-4" /> New segment</button>
    {open ? <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"><section className="premium-panel w-full max-w-lg p-6"><div className="mb-5 flex items-start justify-between"><div><p className="page-eyebrow">Audience</p><h2 className="mt-1 text-2xl font-black">New segment</h2></div><button className="icon-button" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div><form action={create} className="space-y-4"><label className="block"><span className="mb-1.5 block text-sm font-bold">Name</span><input name="name" required className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" /></label><label className="block"><span className="mb-1.5 block text-sm font-bold">Description</span><input name="description" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" /></label><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-sm font-bold">Field</span><select name="field" value={field} onChange={(e)=>setField(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="email_domain">Email domain</option><option value="validation_status">Validation status</option><option value="contact_status">Contact status</option><option value="custom_attribute">Imported custom field</option></select></label><label><span className="mb-1.5 block text-sm font-bold">Operator</span><select name="operator" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm"><option value="equals">Equals</option><option value="not_equals">Not equals</option></select></label></div>{field === "custom_attribute" ? <label className="block"><span className="mb-1.5 block text-sm font-bold">Custom field key</span><input name="attributeKey" required className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" placeholder="city / state / occupation / FATHER NAME"/><span className="mt-1 block text-[11px] text-[var(--muted)]">Use the imported column/attribute name exactly as stored.</span></label> : null}<label className="block"><span className="mb-1.5 block text-sm font-bold">Value</span><input name="value" required className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm" placeholder={field === "custom_attribute" ? "Raipur / Student / Yes" : "gmail.com / accepted / active"} /></label>{error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}<button disabled={busy} className="btn-primary w-full">{busy ? "Creating…" : "Create segment"}</button></form></section></div> : null}
  </>;
}
