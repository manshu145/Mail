"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UserRowActions({id,status,role}:{id:string;status:"active"|"disabled";role:"owner"|"admin"|"operator"}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  if(role==="owner") return <span className="text-xs font-bold text-zinc-400">Owner protected</span>;

  async function patch(body:Record<string,string>) {
    setBusy(true); setError("");
    try {
      const response=await fetch(`/api/users/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) { setError(payload.error||"Could not update user."); return; }
      router.refresh();
    } catch {
      setError("Could not reach NexiMail.");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <div className="flex flex-wrap gap-2">
      <select disabled={busy} value={role} onChange={e=>void patch({role:e.target.value})} className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs font-bold dark:border-zinc-800 dark:bg-zinc-900">
        <option value="admin">Admin</option><option value="operator">Operator</option>
      </select>
      <button disabled={busy} onClick={()=>void patch({status:status==="active"?"disabled":"active"})} className={status==="active"?"btn-danger !min-h-8 !px-2.5 !py-1 text-xs":"btn-secondary !min-h-8 !px-2.5 !py-1 text-xs"}>{status==="active"?"Disable":"Enable"}</button>
    </div>
    {error?<p role="alert" className="mt-1.5 max-w-52 text-[10px] font-bold text-rose-600">{error}</p>:null}
  </div>;
}
