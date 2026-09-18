"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DuplicateCampaignButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function duplicate() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/campaigns/${id}/duplicate`, { method: "POST" });
      const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !data.id) { setError(data.error || "Could not duplicate campaign."); return; }
      router.push(`/campaigns/${data.id}`);
    } catch {
      setError("Could not reach NexiMail.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-col items-end gap-1">
    <button type="button" disabled={busy} onClick={duplicate} className="btn-secondary">
      <Copy className="h-4 w-4"/>{busy ? "Creating copy…" : "Reuse campaign"}
    </button>
    {error ? <span className="text-[11px] font-bold text-rose-600">{error}</span> : null}
  </div>;
}
