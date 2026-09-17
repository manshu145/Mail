"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeliverySettings } from "@/lib/delivery-settings";

const fields: Array<{ key:keyof DeliverySettings; label:string; help:string; step?:string; display?:"percent" }> = [
  { key:"maxPerSecond", label:"Max per second", help:"Transport throttle applied by the transport worker." },
  { key:"maxRecipientsPerCampaign", label:"Max recipients / campaign", help:"Campaign worker hard ceiling." },
  { key:"maxRollingHour", label:"Max rolling hour", help:"Sending-account rolling one-hour ceiling." },
  { key:"maxRolling24h", label:"Max rolling 24h", help:"Sending-account rolling 24-hour ceiling." },
  { key:"maxActiveQueued", label:"Max active / queued", help:"Backpressure ceiling before policy release pauses." },
  { key:"retryMaxAttempts", label:"Maximum transport attempts", help:"Failed submissions stop after this many attempts." },
  { key:"retryInitialSeconds", label:"Initial retry wait (seconds)", help:"Base delay after a transport submission failure." },
  { key:"retryMaxSeconds", label:"Maximum retry wait (seconds)", help:"Upper cap for progressive retry delay." },
  { key:"retryBackoffMultiplier", label:"Retry backoff multiplier", help:"Progressive delay multiplier.", step:"0.1" },
  { key:"reputationBounceStopRate", label:"Bounce stop rate (%)", help:"Pause active sending account when 24h bounce rate crosses this threshold.", step:"0.01", display:"percent" },
  { key:"reputationComplaintStopRate", label:"Complaint stop rate (%)", help:"Pause active sending account when complaint rate crosses this threshold.", step:"0.01", display:"percent" },
  { key:"reputationMinSample", label:"Reputation minimum sample", help:"Do not judge account reputation below this 24h sample size." },
];

export function DeliverySettingsForm({ initial, editable }: { initial: DeliverySettings; editable: boolean }) {
  const router = useRouter();
  const [values,setValues]=useState<Record<string,string>>(() => Object.fromEntries(fields.map((field) => [field.key, String(field.display === "percent" ? initial[field.key] * 100 : initial[field.key])])));
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [error,setError]=useState("");

  async function save() {
    if (!editable || busy) return;
    setBusy(true); setError(""); setMessage("");
    const body: Record<string,number> = {};
    for (const field of fields) {
      const parsed=Number(values[field.key]);
      if (!Number.isFinite(parsed)) { setError(`${field.label} must be numeric.`); setBusy(false); return; }
      body[field.key]=field.display === "percent" ? parsed / 100 : parsed;
    }
    try {
      const response=await fetch("/api/delivery-settings",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(payload.error||"Failed to save delivery settings.");
      setMessage("Saved. Workers read these values from the shared database control plane.");
      router.refresh();
    } catch(e){setError(e instanceof Error?e.message:"Failed to save delivery settings.");}
    finally{setBusy(false)}
  }

  return <div className="space-y-5">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{fields.map((field)=><label key={field.key} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><span className="text-xs font-black">{field.label}</span><input disabled={!editable||busy} type="number" step={field.step||"1"} value={values[field.key]} onChange={(e)=>setValues((v)=>({...v,[field.key]:e.target.value}))} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-bold outline-none focus:border-violet-500 disabled:opacity-60"/><span className="mt-2 block text-[11px] leading-5 text-[var(--muted)]">{field.help}</span></label>)}</div>
    <div className="flex flex-wrap items-center justify-end gap-3">{error?<span className="mr-auto text-xs font-bold text-rose-500">{error}</span>:message?<span className="mr-auto text-xs font-bold text-emerald-600">{message}</span>:null}<button type="button" disabled={!editable||busy} onClick={save} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy?"Saving…":"Save & apply settings"}</button></div>
  </div>;
}
