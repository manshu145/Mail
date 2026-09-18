"use client";

import { Copy, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CampaignReuseAction({
  campaignId,
  lists,
  currentListId,
}: {
  campaignId: string;
  lists: Array<{ id: string; name: string }>;
  currentListId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState(lists.find((x) => x.id !== currentListId)?.id || currentListId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function duplicate() {
    if (!listId) { setError("Choose an audience list."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/duplicate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId }),
      });
      const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !data.id) { setError(data.error || "Could not reuse campaign."); return; }
      router.push(`/campaigns/${data.id}`);
    } catch {
      setError("Could not create the reusable campaign draft.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="relative">
    <button type="button" className="btn-secondary" onClick={() => setOpen((v) => !v)}>
      <Copy className="h-4 w-4"/> Reuse campaign
    </button>
    {open ? <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[320px] max-w-[82vw] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600"><Send className="h-4 w-4"/></div>
        <div><p className="text-sm font-black">Send same campaign again</p><p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Creates a new draft with the same content, sender, tracking and attachments. Original report stays unchanged.</p></div>
      </div>
      <label className="mt-4 block text-xs font-bold">New audience
        <select value={listId} onChange={(e)=>setListId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm">
          <option value="">Choose list / segment</option>
          {lists.map((list)=><option key={list.id} value={list.id}>{list.name}{list.id===currentListId?" · current":""}</option>)}
        </select>
      </label>
      {error ? <p className="mt-3 text-xs font-bold text-rose-600">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary !min-h-9" onClick={()=>setOpen(false)}>Cancel</button>
        <button type="button" className="btn-primary !min-h-9" disabled={busy || !listId} onClick={()=>void duplicate()}>{busy?"Creating…":"Create draft"}</button>
      </div>
    </div> : null}
  </div>;
}
