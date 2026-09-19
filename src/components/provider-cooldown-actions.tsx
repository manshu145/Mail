"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProviderCooldownActions({ id, active, canEdit }: { id: string; active: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");

  async function checkNow() {
    if(!canEdit||busy||!active) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response=await fetch(`/api/provider-cooldowns/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "probe_now" })
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) throw new Error(payload.error||"Could not request a provider check.");
      setMessage("Check queued. NexiMail will send one controlled probe.");
      router.refresh();
    } catch(e) {
      setError(e instanceof Error?e.message:"Could not request a provider check.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="shrink-0">
    {canEdit&&active?<button disabled={busy} onClick={() => void checkNow()} className="btn-secondary !min-h-9 !px-3 text-xs">
      <RefreshCw className={`h-3.5 w-3.5 ${busy?"animate-spin":""}`}/>
      {busy ? "Checking…" : "Check now"}
    </button>:null}
    {error?<p className="mt-2 max-w-72 text-[11px] font-bold text-rose-500">{error}</p>:message?<p className="mt-2 max-w-72 text-[11px] font-bold text-emerald-600">{message}</p>:null}
  </div>;
}
