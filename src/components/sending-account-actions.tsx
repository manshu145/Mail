"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SendingAccountActions({id,status}:{id:string;status:string;hourly?:number;daily?:number}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  async function toggle() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response=await fetch(`/api/sending-accounts/${id}`,{
        method:"PATCH",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({status:status==="active"?"paused":"active"})
      });
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) { setError(payload.error||"Could not update sender identity."); return; }
      setMessage(status==="active"?"Sender paused.":"Sender activated.");
      router.refresh();
    } catch {
      setError("Could not update sender identity.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button disabled={busy} onClick={()=>void toggle()} className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs">
        {busy?"Saving…":status==="active"?"Pause sender":"Activate sender"}
      </button>
    </div>
    {error?<p role="alert" className="mt-2 text-[10.5px] font-bold text-rose-600">{error}</p>:message?<p role="status" className="mt-2 text-[10.5px] font-bold text-emerald-600">{message}</p>:null}
  </>;
}
