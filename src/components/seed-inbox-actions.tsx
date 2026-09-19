"use client";

import { Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SeedInboxActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/seed-inboxes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Could not update seed inbox.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach NexiMail.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-col items-end gap-1">
    <button
      type="button"
      disabled={busy}
      onClick={toggle}
      className="btn-secondary !min-h-0 !px-2.5 !py-1.5 !text-[11px]"
    >
      {active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
      {busy ? "Saving…" : active ? "Disable" : "Enable"}
    </button>
    {error ? <span className="max-w-48 text-right text-[11px] font-semibold text-rose-600">{error}</span> : null}
  </div>;
}
