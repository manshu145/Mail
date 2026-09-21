import { CheckCircle2, Clock3, Globe2, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db,databaseConfigured } from "@/db";
import { sendingDomains } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";

const fmt=(value:Date)=>new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(value);
const bounceMxTarget=String(process.env.MTA_HOSTNAME||"").trim();
const bounceSpfIp=String(process.env.MTA_PUBLIC_IP||"").trim();

export default async function DomainsPage(){
  const session=await getSession();if(!session)redirect("/login");
  let rows:typeof sendingDomains.$inferSelect[]=[];let bad=false;
  if(databaseConfigured)try{rows=await db.select().from(sendingDomains).orderBy(desc(sendingDomains.createdAt))}catch{bad=true}
  const usable=databaseConfigured&&!bad;
  const ready=rows.filter((row)=>row.status==="ready").length;

  return <AppShell session={session}>
    <div className="page-intro">
      <div><div className="mb-2 flex items-center gap-2"><p className="page-eyebrow">Deliverability</p>{rows.length?<span className="status-pill"><ShieldCheck className="h-3.5 w-3.5"/>{ready}/{rows.length} ready</span>:null}</div><h1 className="page-title">Sending domains</h1><p className="page-description">Publish authentication records and monitor SPF, DKIM and DMARC readiness before sending.</p></div>
      <ResourceCreate disabled={!usable||session.role!=="owner"} endpoint="/api/resources/domains" title="Add sending domain" buttonLabel="Add domain" fields={[{name:"domain",label:"Domain",required:true,placeholder:"example.com"},{name:"trackingDomain",label:"Tracking domain",placeholder:"click.example.com"},{name:"bounceDomain",label:"Bounce / return-path domain",placeholder:"nm-bounce.example.com"},{name:"dkimSelector",label:"DKIM selector",placeholder:"default"}]}/>
    </div>

    {!usable?<div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/[.07] px-4 py-3.5 text-sm text-amber-800 dark:text-amber-200"><b>Domain settings are temporarily unavailable.</b></div>:null}

    <section className="space-y-3">
      {rows.length?rows.map(r=>{
        const dkimValue=r.dkimPublicKey?`v=DKIM1; k=rsa; p=${r.dkimPublicKey}`:null;
        const checks=[["SPF",r.spfOk],["DKIM",r.dkimOk],["DMARC",r.dmarcOk]] as const;
        const passed=checks.filter(([,ok])=>ok).length;
        return <article key={r.id} className="premium-panel surface-lift overflow-hidden">
          <div className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/10 text-[var(--accent)]"><Globe2 className="h-4.5 w-4.5"/></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-black">{r.domain}</h2><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.08em] ${r.status==="ready"?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":r.status==="disabled"?"bg-[var(--surface-muted)] text-[var(--muted)]":"bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{r.status}</span></div><p className="mt-1 text-xs text-[var(--muted)]">Tracking: {r.trackingDomain||"default application domain"}</p><p className="mt-1 text-xs text-[var(--muted)]">Return-Path: {r.bounceDomain||"legacy server fallback"}</p></div></div>
              </div>
              <div className="w-full lg:w-[360px]">
                <div className="mb-2 flex items-center justify-between text-[10px] font-bold text-[var(--muted)]"><span>Authentication readiness</span><b className="text-[var(--foreground)]">{passed}/3 passed</b></div>
                <div className="progress-track"><div className="progress-fill" style={{width:`${passed/3*100}%`}}/></div>
                <div className="mt-3 grid grid-cols-3 gap-2">{checks.map(([label,ok])=><div key={label} className={`rounded-xl border px-2 py-2 text-center text-[10px] font-black ${ok?"border-emerald-500/15 bg-emerald-500/[.06] text-emerald-700 dark:text-emerald-300":"border-amber-500/15 bg-amber-500/[.06] text-amber-700 dark:text-amber-300"}`}><div className="flex items-center justify-center gap-1">{ok?<CheckCircle2 className="h-3 w-3"/>:<Clock3 className="h-3 w-3"/>}{label}</div><div className="mt-1">{ok?"PASS":"PENDING"}</div></div>)}</div>
              </div>
            </div>
          </div>

          {dkimValue?<details className="border-t border-[var(--border)] bg-[var(--surface-soft)]">
            <summary className="cursor-pointer list-none px-4 py-3.5 text-xs font-black sm:px-5">DKIM DNS record <span className="ml-2 text-[10px] font-semibold text-[var(--muted)]">tap to view</span></summary>
            <div className="border-t border-[var(--border)] px-4 py-4 sm:px-5"><div className="grid gap-3 lg:grid-cols-[.36fr_1fr]"><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Host / Name</p><code className="mt-1 block break-all rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs font-bold">{r.dkimSelector}._domainkey.{r.domain}</code></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">TXT value</p><code className="mt-1 block max-h-44 overflow-auto break-all rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[10px] leading-5">{dkimValue}</code></div></div><p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">After DNS propagation, NexiMail verifies that the published key matches this sending domain.</p></div>
          </details>:null}

          {r.bounceDomain?<details className="border-t border-[var(--border)] bg-[var(--surface-soft)]">
            <summary className="cursor-pointer list-none px-4 py-3.5 text-xs font-black sm:px-5">Bounce / Return-Path DNS <span className="ml-2 text-[10px] font-semibold text-[var(--muted)]">{r.bounceStatus} · MX {r.bounceMxOk?"PASS":"PENDING"} · SPF {r.bounceSpfOk?"PASS":"PENDING"}</span></summary>
            <div className="border-t border-[var(--border)] px-4 py-4 sm:px-5">
              <div className="grid gap-3 lg:grid-cols-2">
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">MX</p><code className="mt-1 block break-all rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">{r.bounceDomain} → {bounceMxTarget||"configure MTA_HOSTNAME"}</code></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">SPF TXT</p><code className="mt-1 block break-all rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">{bounceSpfIp?`v=spf1 ip4:${bounceSpfIp} -all`:"configure MTA_PUBLIC_IP"}</code></div>
              </div>
              <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">NexiMail uses this domain only for the SMTP envelope Return-Path. Each sending domain can have its own bounce identity.</p>
            </div>
          </details>:null}

          <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[10px] text-[var(--muted)] sm:px-5"><Clock3 className="h-3.5 w-3.5"/>Last checked: {r.lastCheckedAt?fmt(r.lastCheckedAt):"Waiting for first DNS check"}</div>
        </article>
      }):<div className="premium-panel grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/10 text-[var(--accent)]"><Globe2 className="h-6 w-6"/></div><h2 className="mt-4 font-black">No sending domains yet</h2><p className="mt-1 text-sm text-[var(--muted)]">Add your first sending domain to generate its DKIM record.</p></div></div>}
    </section>
  </AppShell>;
}
