"use client";

import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ModalPortal } from "@/components/modal-portal";

type Props={
  id:string;
  status:string;
  name:string;
  fromName:string;
  fromEmail:string;
  replyTo:string|null;
  hourlyLimit:number;
  dailyLimit:number;
  canEdit:boolean;
};

export function SendingAccountActions({id,status,name,fromName,fromEmail,replyTo,hourlyLimit,dailyLimit,canEdit}:Props) {
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [open,setOpen]=useState(false);

  async function patch(body:Record<string,unknown>) {
    const response=await fetch(`/api/sending-accounts/${id}`,{
      method:"PATCH",
      headers:{"content-type":"application/json"},
      body:JSON.stringify(body)
    });
    const payload=await response.json().catch(()=>({})) as {error?:string};
    if(!response.ok) throw new Error(payload.error||"Could not update sender identity.");
  }

  async function toggle() {
    setBusy(true); setError(""); setMessage("");
    try {
      await patch({status:status==="active"?"paused":"active"});
      setMessage(status==="active"?"Sender paused.":"Sender activated.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error?e.message:"Could not update sender identity.");
    } finally {
      setBusy(false);
    }
  }

  async function save(formData:FormData) {
    setBusy(true); setError(""); setMessage("");
    try {
      await patch({
        name:String(formData.get("name")||""),
        fromName:String(formData.get("fromName")||""),
        fromEmail:String(formData.get("fromEmail")||""),
        replyTo:String(formData.get("replyTo")||""),
        hourlyLimit:Number(formData.get("hourlyLimit")||0),
        dailyLimit:Number(formData.get("dailyLimit")||0),
      });
      setOpen(false);
      setMessage("Sender identity updated.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error?e.message:"Could not update sender identity.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy]);

  return <>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {canEdit?<button type="button" disabled={busy} onClick={()=>{setError("");setMessage("");setOpen(true)}} className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs"><Pencil className="h-3.5 w-3.5"/> Edit sender</button>:null}
      <button type="button" disabled={busy||!canEdit} onClick={()=>void toggle()} className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs">
        {busy?"Saving…":status==="active"?"Pause sender":"Activate sender"}
      </button>
    </div>

    {error?<p role="alert" className="mt-2 text-xs font-bold text-rose-600">{error}</p>:message?<p role="status" className="mt-2 text-xs font-bold text-emerald-600">{message}</p>:null}

    {open?<ModalPortal><div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-3 py-4 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e)=>{if(e.target===e.currentTarget&&!busy)setOpen(false)}}>
      <section role="dialog" aria-modal="true" aria-labelledby={`edit-sender-${id}`} className="premium-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden sm:max-h-[calc(100dvh-3rem)]">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6 sm:py-5">
          <div><p className="page-eyebrow">Sender identity</p><h2 id={`edit-sender-${id}`} className="mt-1 text-xl font-black">Edit sender</h2><p className="mt-1 text-xs text-[var(--muted)]">Update sender details and the address that receives replies.</p></div>
          <button type="button" disabled={busy} onClick={()=>setOpen(false)} aria-label="Close edit sender" className="icon-button grid shrink-0"><X className="h-4 w-4"/></button>
        </div>

        <form action={save} className="flex min-h-0 flex-1 flex-col">
          <div className="modal-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
            <label className="block"><span className="mb-1.5 block text-sm font-bold">Identity name</span><input name="name" defaultValue={name} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none"/></label>
            <label className="block"><span className="mb-1.5 block text-sm font-bold">From name</span><input name="fromName" defaultValue={fromName} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none"/></label>
            <label className="block"><span className="mb-1.5 block text-sm font-bold">From email</span><input name="fromEmail" type="email" defaultValue={fromEmail} required className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none"/><span className="mt-1.5 block text-[11px] leading-4 text-[var(--muted)]">Changing the sender domain still has to pass NexiMail domain/auth checks before delivery.</span></label>
            <label className="block"><span className="mb-1.5 block text-sm font-bold">Reply-to</span><input name="replyTo" type="email" defaultValue={replyTo||""} placeholder="Leave blank to use From email" className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none"/></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-sm font-bold">Sender hourly limit</span><input name="hourlyLimit" type="number" min="0" step="1" defaultValue={hourlyLimit} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none"/><span className="mt-1.5 block text-[11px] leading-4 text-[var(--muted)]">0 = unlimited. Global workspace limits can still apply.</span></label>
              <label className="block"><span className="mb-1.5 block text-sm font-bold">Sender 24-hour limit</span><input name="dailyLimit" type="number" min="0" step="1" defaultValue={dailyLimit} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 py-3 text-sm outline-none"/><span className="mt-1.5 block text-[11px] leading-4 text-[var(--muted)]">0 = unlimited. No hidden platform cap.</span></label>
            </div>
            {error?<p role="alert" className="text-sm font-semibold text-rose-600">{error}</p>:null}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:flex sm:justify-end sm:px-6">
            <button type="button" disabled={busy} onClick={()=>setOpen(false)} className="btn-secondary w-full sm:w-auto">Cancel</button>
            <button disabled={busy} className="btn-primary w-full sm:w-auto">{busy?"Saving…":"Save changes"}</button>
          </div>
        </form>
      </section>
    </div></ModalPortal>:null}
  </>;
}
