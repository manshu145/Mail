"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Webhook, X } from "lucide-react";

export function WebhookCreate({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");

  async function create(formData: FormData) {
    setBusy(true); setError(""); setSecret("");
    const response = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: formData.get("name"), url: formData.get("url") }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string; secret?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error || "Could not add webhook."); return; }
    setSecret(data.secret || "");
    router.refresh();
  }

  return <>
    <button disabled={disabled} className="btn-primary" onClick={() => setOpen(true)}><Webhook className="h-4 w-4" /> Add endpoint</button>
    {open ? <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"><section className="premium-panel max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4"><div><p className="page-eyebrow">Developer platform</p><h2 className="mt-1 text-2xl font-black">Add webhook</h2></div><button className="icon-button grid" onClick={() => { setOpen(false); setSecret(""); setError(""); }}><X className="h-4 w-4" /></button></div>
      {secret ? <div><p className="text-sm font-bold">Copy the signing secret now. It will not be shown again.</p><code className="mt-3 block break-all rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 text-xs">{secret}</code><button className="btn-primary mt-4 w-full" onClick={() => navigator.clipboard.writeText(secret)}>Copy secret</button></div> : <form action={create} className="space-y-4">
        <label className="block"><span className="mb-1.5 block text-sm font-bold">Name</span><input required name="name" maxLength={120} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" placeholder="CRM events" /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-bold">HTTPS endpoint</span><input required name="url" type="url" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" placeholder="https://example.com/webhooks/neximail" /></label>
        {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}
        <button disabled={busy} className="btn-primary w-full">{busy ? "Adding…" : "Add endpoint"}</button>
      </form>}
    </section></div> : null}
  </>;
}

export function WebhookActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const response = await fetch(`/api/webhooks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !active }) });
    setBusy(false); if (response.ok) router.refresh();
  }
  async function remove() {
    if (!confirm("Delete this webhook endpoint and its pending deliveries?")) return;
    setBusy(true); const response = await fetch(`/api/webhooks/${id}`, { method: "DELETE" }); setBusy(false); if (response.ok) router.refresh();
  }
  return <div className="flex gap-2"><button disabled={busy} className="btn-secondary !min-h-8 !px-3 !py-1 text-xs" onClick={toggle}>{active ? "Disable" : "Enable"}</button><button disabled={busy} className="btn-danger !min-h-8 !px-3 !py-1 text-xs" onClick={remove}>Delete</button></div>;
}
