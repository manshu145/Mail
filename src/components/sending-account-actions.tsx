"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SendingAccountActions({id,status,hourly,daily}:{id:string;status:string;hourly:number;daily:number}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [h,setH]=useState(hourly);
  const [d,setD]=useState(daily);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

  async function patch(body:Record<string,unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response=await fetch(`/api/sending-accounts/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) { setError(payload.error||"Could not update sender identity."); return; }
      setMessage("Saved.");
      router.refresh();
    } catch {
      setError("Could not reach NexiMail.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="mt-3 text-[11px] font-bold text-zinc-400">Set hourly/daily to 0 for unlimited volume. Warm-up, cooldown and reputation safety still apply.</div>
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="text-xs font-bold text-zinc-500">Hourly<input type="number" min="0" value={h} onChange={e=>setH(Number(e.target.value))} className="mt-1 block w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900"/></label>
      <label className="text-xs font-bold text-zinc-500">Daily<input type="number" min="0" value={d} onChange={e=>setD(Number(e.target.value))} className="mt-1 block w-28 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900"/></label>
      <button disabled={busy} onClick={()=>void patch({hourlyLimit:h,dailyLimit:d})} className="btn-secondary !min-h-8 !px-2.5 !py-1 text-xs">Save limits</button>
      <button disabled={busy} onClick={()=>void patch({status:status==="active"?"paused":"active"})} className="btn-secondary !min-h-8 !px-2.5 !py-1 text-xs">{status==="active"?"Pause":"Activate"}</button>
    </div>
    {error?<p role="alert" className="mt-2 text-[10.5px] font-bold text-rose-600">{error}</p>:message?<p role="status" className="mt-2 text-[10.5px] font-bold text-emerald-600">{message}</p>:null}
  </>;
}
