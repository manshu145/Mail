"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProviderCooldownActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function patch(action: "clear" | "reactivate") {
    setBusy(true);
    try {
      await fetch(`/api/provider-cooldowns/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      router.refresh();
    } finally { setBusy(false); }
  }
  return <button disabled={busy} onClick={() => patch(active ? "clear" : "reactivate")} className="btn-secondary !min-h-8 !px-2.5 !py-1 text-xs">{busy ? "Saving…" : active ? "Clear cooldown" : "Reactivate"}</button>;
}
