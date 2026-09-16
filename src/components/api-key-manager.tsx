"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, X } from "lucide-react";

const scopes = ["contacts:read", "contacts:write", "campaigns:read", "campaigns:write", "smtp:submit"];

export function ApiKeyManager({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");

  async function create(formData: FormData) {
    setBusy(true); setError(""); setSecret("");
    const selected = scopes.filter((scope) => formData.get(scope) === "on");
    const response = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: formData.get("name"), scopes: selected }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string; secret?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error || "Could not create API key."); return; }
    setSecret(data.secret || "");
    router.refresh();
  }

  return <>
    <button disabled={disabled} className="btn-primary" onClick={() => setOpen(true)}><KeyRound className="h-4 w-4" /> Create API key</button>
    {open ? <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <section className="premium-panel w-full max-w-lg p-6">
        <div className="mb-5 flex items-start justify-between gap-4"><div><p className="page-eyebrow">Developer access</p><h2 className="mt-1 text-2xl font-black">Create API key</h2></div><button className="icon-button" onClick={() => { setOpen(false); setSecret(""); setError(""); }}><X className="h-4 w-4" /></button></div>
        {secret ? <div><p className="text-sm font-bold">Copy this key now. It will not be shown again.</p><code className="mt-3 block break-all rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 text-xs">{secret}</code><button className="btn-primary mt-4 w-full" onClick={async () => { await navigator.clipboard.writeText(secret); }}>Copy key</button></div> : <form action={create} className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-sm font-bold">Key name</span><input name="name" required maxLength={120} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none" placeholder="Automation server" /></label>
          <div><p className="mb-2 text-sm font-bold">Scopes</p><div className="grid gap-2 sm:grid-cols-2">{scopes.map((scope) => <label key={scope} className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-xs font-bold"><input type="checkbox" name={scope} /> {scope}</label>)}</div></div>
          {error ? <p className="text-sm font-semibold text-rose-600">{error}</p> : null}
          <button disabled={busy} className="btn-primary w-full">{busy ? "Creating…" : "Create key"}</button>
        </form>}
      </section>
    </div> : null}
  </>;
}

export function ApiKeyRevoke({ id, disabled }: { id: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function revoke() {
    setBusy(true);
    const response = await fetch(`/api/api-keys/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revoke" }) });
    setBusy(false);
    if (response.ok) router.refresh();
  }
  return <button disabled={disabled || busy} onClick={revoke} className="btn-danger !min-h-8 !px-3 !py-1 text-xs">Revoke</button>;
}
