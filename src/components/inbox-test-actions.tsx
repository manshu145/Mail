"use client";

import { Send, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InboxTestActions({ id, status, hasCampaign }: { id: string; status: string; hasCampaign: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function send() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/inbox-placement/${id}/send`, { method: "POST" });
    const data = await response.json().catch(() => ({})) as { error?: string; sent?: number; failed?: number };
    setBusy(false);
    if (!response.ok) { setMessage(data.error || "Seed send failed"); return; }
    setMessage(`Sent to ${data.sent || 0} seed inbox${data.sent === 1 ? "" : "es"}${data.failed ? ` · ${data.failed} failed` : ""}`);
    router.refresh();
  }

  if (status === "completed") return <span className="text-xs font-bold text-emerald-600">Completed</span>;
  return <div className="flex min-w-[160px] flex-col items-end gap-1.5">
    <button type="button" disabled={busy || !hasCampaign} onClick={() => void send()} className="btn-secondary whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin"/> : <Send className="mr-2 inline h-3.5 w-3.5"/>}
      {busy ? "Sending…" : status === "running" ? "Resend seeds" : "Send to seeds"}
    </button>
    {!hasCampaign ? <span className="text-[11px] text-amber-600">Campaign required</span> : null}
    {message ? <span className="max-w-[220px] text-right text-[11px] font-semibold text-[var(--muted)]">{message}</span> : null}
  </div>;
}
