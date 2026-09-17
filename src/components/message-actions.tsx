"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MessageActions({id,status}:{id:string;status:string}){
  const router=useRouter(),[busy,setBusy]=useState(false);
  async function act(action:"retry"|"cancel"){
    setBusy(true);
    try{await fetch(`/api/messages/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action})});router.refresh();}
    finally{setBusy(false)}
  }
  return <div className="flex gap-2">
    <Link href={`/messages/${id}`} className="btn-secondary !min-h-8 !px-2.5 !py-1 text-xs">Inspect</Link>
    {["deferred","failed"].includes(status)?<button disabled={busy} onClick={()=>act("retry")} className="btn-secondary !min-h-8 !px-2.5 !py-1 text-xs">Retry</button>:null}
    {["queued","ready_for_transport","deferred"].includes(status)?<button disabled={busy} onClick={()=>act("cancel")} className="btn-danger !min-h-8 !px-2.5 !py-1 text-xs">Cancel</button>:null}
  </div>
}
