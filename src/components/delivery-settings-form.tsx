"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeliverySettings } from "@/lib/delivery-settings";

type Section = "Reputation protection" | "Sending limits" | "Multi-campaign delivery" | "Retry policy";
type Field = { key:keyof DeliverySettings; label:string; help:string; section:Section; step?:string; min?:string; max?:string; display?:"percent" };

const fields: Field[] = [
  { key:"reputationBounceStopRate", section:"Reputation protection", label:"Pause sender at bounce rate (%)", help:"Automatically pause a sender when its 24-hour bounce rate reaches this level. 0 = disabled.", step:"0.01", display:"percent" },
  { key:"reputationComplaintStopRate", section:"Reputation protection", label:"Pause sender at complaint rate (%)", help:"Automatically pause a sender when complaint rate reaches this level. 0 = disabled.", step:"0.01", display:"percent" },
  { key:"reputationMinSample", section:"Reputation protection", label:"Minimum sample before auto-pause", help:"Reputation thresholds are ignored until at least this many messages are observed." },
  { key:"providerCooldownMinutes", section:"Reputation protection", label:"Provider cooldown / probe interval (minutes)", help:"When a provider applies temporary pressure, NexiMail holds only that provider and probes again after this interval. Allowed range: 1–60 minutes.", min:"1", max:"60" },
  { key:"canaryInitialBatch", section:"Reputation protection", label:"Adaptive first batch", help:"Recipients released first for a larger campaign before delivery health is evaluated." },
  { key:"canarySecondBatch", section:"Reputation protection", label:"Second ramp batch", help:"Additional recipients released after the first batch has healthy outcomes." },
  { key:"canaryThirdBatch", section:"Reputation protection", label:"Third ramp batch", help:"Additional recipients released before the remaining audience is opened." },
  { key:"canaryBounceWarnRate", section:"Reputation protection", label:"Canary slowdown bounce rate (%)", help:"Slow the next ramp when observed hard-bounce rate reaches this internal safety threshold. 0 = disabled.", step:"0.01", display:"percent" },

  { key:"maxPerSecond", section:"Sending limits", label:"Maximum sends per second", help:"Global release speed. Lower values are gentler; higher values require stronger reputation and capacity." },
  { key:"maxRecipientsPerCampaign", section:"Sending limits", label:"Recipients per campaign", help:"0 = unlimited. Use a value only when you want a hard campaign-size ceiling." },
  { key:"maxRollingHour", section:"Sending limits", label:"Global hourly limit", help:"0 = unlimited. Sender-specific limits, warm-up and reputation protection still apply." },
  { key:"maxRolling24h", section:"Sending limits", label:"Global 24-hour limit", help:"0 = unlimited. This is an optional global safety ceiling." },
  { key:"maxActiveQueued", section:"Sending limits", label:"Maximum active / queued messages", help:"Backpressure ceiling used to avoid releasing more work than the system can safely process." },

  { key:"maxConcurrentCampaigns", section:"Multi-campaign delivery", label:"Maximum simultaneous campaigns", help:"How many campaigns may be in active sending state at once. Additional queued or scheduled campaigns wait for a free slot.", min:"1", max:"25" },
  { key:"campaignBurstPerRound", section:"Multi-campaign delivery", label:"Messages per campaign turn", help:"Round-robin fairness. 1 alternates one message per campaign; higher values let each campaign send a small burst before rotating.", min:"1", max:"50" },

  { key:"retryMaxAttempts", section:"Retry policy", label:"Maximum delivery attempts", help:"Temporary delivery failures stop retrying after this many attempts." },
  { key:"retryInitialSeconds", section:"Retry policy", label:"Initial retry wait (seconds)", help:"Wait time before the first retry after a temporary transport failure." },
  { key:"retryMaxSeconds", section:"Retry policy", label:"Maximum retry wait (seconds)", help:"Upper cap for progressively increasing retry delays." },
  { key:"retryBackoffMultiplier", section:"Retry policy", label:"Retry backoff multiplier", help:"Controls how quickly the retry delay increases after repeated temporary failures.", step:"0.1" },
];

const sections: Array<{name:Section; description:string}> = [
  { name:"Reputation protection", description:"Automatic safety rules that protect sender reputation and react to mailbox-provider pressure." },
  { name:"Sending limits", description:"Optional global ceilings. Keep volume limits at 0 when you do not want a platform-level cap." },
  { name:"Multi-campaign delivery", description:"Run multiple campaigns together without allowing one large campaign to monopolize the queue. NexiMail rotates fairly across active campaigns." },
  { name:"Retry policy", description:"How NexiMail retries temporary delivery failures without creating uncontrolled retry loops." },
];

export function DeliverySettingsForm({ initial, editable }: { initial: DeliverySettings; editable: boolean }) {
  const router = useRouter();
  const [values,setValues]=useState<Record<string,string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, String(field.display === "percent" ? initial[field.key] * 100 : initial[field.key])]))
  );
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");

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
      const payload=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) throw new Error(payload.error||"Failed to save delivery settings.");
      setMessage("Saved. New thresholds and limits are now active.");
      router.refresh();
    } catch(e) {
      setError(e instanceof Error?e.message:"Failed to save delivery settings.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-6">
    {sections.map((section)=><section key={section.name}>
      <div className="mb-3">
        <h3 className="text-[15px] font-black">{section.name}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">{section.description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fields.filter((field)=>field.section===section.name).map((field)=><label key={field.key} className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
          <span className="text-xs font-black">{field.label}</span>
          <input disabled={!editable||busy} type="number" step={field.step||"1"} min={field.min} max={field.max} value={values[field.key]} onChange={(e)=>setValues((v)=>({...v,[field.key]:e.target.value}))} className="mt-2 w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm font-bold outline-none focus:border-violet-500 disabled:opacity-60"/>
          <span className="mt-2 block text-[11px] leading-5 text-[var(--muted)]">{field.help}</span>
        </label>)}
      </div>
    </section>)}

    <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {error?<p className="text-xs font-bold text-rose-500">{error}</p>:message?<p className="text-xs font-bold text-emerald-600">{message}</p>:!editable?<p className="text-xs text-[var(--muted)]">Owner access is required to change these controls.</p>:null}
      </div>
      <button type="button" disabled={!editable||busy} onClick={save} className="btn-primary w-full sm:w-auto">{busy?"Saving…":"Save reputation & delivery settings"}</button>
    </div>
  </div>;
}
