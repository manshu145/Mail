"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProviderCooldownActions({ id, active, canEdit }: { id: string; active: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error,setError]=useState("");

  async function patch(action: "clear" | "reactivate") {
    if(!canEdit||busy) return;
    setBusy(true); setError("");
    try {
      const response=await fetch(`/api/provider-cooldowns/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) throw new Error(payload.error||"Could not update provider cooldown.");
      router.refresh();
    } catch(e) {
      setError(e instanceof Error?e.message:"Could not update provider cooldown.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="shrink-0">
    {canEdit?<button disabled={busy} onClick={() => void patch(active ? "clear" : "reactivate")} className="btn-secondary !min-h-9 !px-3 text-xs">{busy ? "Saving…" : active ? "Clear cooldown" : "Reactivate"}</button>:null}
    {error?<p className="mt-2 max-w-64 text-[11px] font-bold text-rose-500">{error}</p>:null}
  </div>;
}
