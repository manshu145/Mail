"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type SegmentField = "email_domain" | "validation_status" | "contact_status" | "custom_attribute";

type Rule = {
  field: SegmentField;
  attributeKey?: string | null;
  operator: "equals" | "not_equals";
  value: string;
} | null;

export function AudienceActions({
  audience,
  rule = null,
  compact = false,
}: {
  audience: { id: string; name: string; description: string | null; isDynamic: boolean };
  rule?: Rule;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState<SegmentField>(rule?.field || "email_domain");

  async function save(formData: FormData) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/lists/${audience.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          description: formData.get("description"),
          field: formData.get("field"),
          operator: formData.get("operator"),
          value: formData.get("value"),
          attributeKey: formData.get("attributeKey"),
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Could not update audience.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach NexiMail. Check connectivity and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${audience.name}"? This cannot be undone. Campaign-linked audiences are protected from deletion.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/lists/${audience.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Could not delete audience.");
        return;
      }
      router.push("/lists");
      router.refresh();
    } catch {
      setError("Could not reach NexiMail. Check connectivity and try again.");
    } finally {
      setBusy(false);
    }
  }

  const buttonClass = compact ? "!min-h-8 !px-2.5 !py-1 text-xs" : "";

  return <>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} onClick={() => { setError(""); setOpen(true); }} className={`btn-secondary ${buttonClass}`}>
        <Pencil className="h-3.5 w-3.5"/> Edit
      </button>
      <button type="button" disabled={busy} onClick={remove} className={`btn-danger ${buttonClass}`}>
        <Trash2 className="h-3.5 w-3.5"/> Delete
      </button>
    </div>
    {error && !open ? <p role="alert" className="mt-2 max-w-sm text-xs font-bold text-rose-600">{error}</p> : null}

    {open ? <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="edit-audience-title" className="premium-panel max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><p className="page-eyebrow">Audience</p><h2 id="edit-audience-title" className="mt-1 text-xl font-black">Edit {audience.isDynamic ? "segment" : "list"}</h2></div>
          <button type="button" disabled={busy} aria-label="Close edit audience" onClick={() => setOpen(false)} className="icon-button grid"><X className="h-4 w-4"/></button>
        </div>
        <form action={save} className="space-y-4">
          <label className="block text-sm font-bold">Name
            <input name="name" required defaultValue={audience.name} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 outline-none" />
          </label>
          <label className="block text-sm font-bold">Description
            <textarea name="description" defaultValue={audience.description || ""} rows={3} className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 outline-none" />
          </label>
          {audience.isDynamic ? <div className="grid gap-3 rounded-2xl border border-violet-500/15 bg-violet-500/[0.04] p-4 sm:grid-cols-2">
            <label className="text-xs font-bold">Rule field
              <select name="field" value={field} onChange={(e)=>setField(e.target.value as typeof field)} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm">
                <option value="email_domain">Email domain</option>
                <option value="validation_status">Validation status</option>
                <option value="contact_status">Contact status</option>
                <option value="custom_attribute">Custom attribute</option>
              </select>
            </label>
            <label className="text-xs font-bold">Operator
              <select name="operator" defaultValue={rule?.operator || "equals"} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm">
                <option value="equals">Equals</option>
                <option value="not_equals">Not equals</option>
              </select>
            </label>
            {field==="custom_attribute"?<label className="text-xs font-bold sm:col-span-2">Attribute key
              <input name="attributeKey" required defaultValue={rule?.attributeKey || ""} placeholder="city / category / industry" className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm" />
            </label>:null}
            <label className="text-xs font-bold sm:col-span-2">Rule value
              <input name="value" required defaultValue={rule?.value || ""} placeholder={field==="custom_attribute"?"Attribute value":"gmail.com / valid / active"} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm" />
            </label>
          </div> : <input type="hidden" name="field" value="" />}
          {error ? <p role="alert" className="text-sm font-bold text-rose-600">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </section>
    </div> : null}
  </>;
}
