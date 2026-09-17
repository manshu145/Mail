"use client";

import Link from "next/link";
import { FileUp, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { error?: string };
type ConsentStatus = "confirmed" | "unconfirmed";

const fieldClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900";

export function ContactsActions({ databaseConfigured }: { databaseConfigured: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submitContact(formData: FormData) {
    setBusy(true);
    setMessage("");
    const consentStatus = String(formData.get("consentStatus") || "unconfirmed") as ConsentStatus;
    const consentSource = String(formData.get("consentSource") || "").trim();
    if (consentStatus === "confirmed" && !consentSource) {
      setBusy(false);
      setMessage("Consent source is required for a confirmed opt-in.");
      return;
    }

    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "single",
          contact: {
            email: formData.get("email"),
            firstName: formData.get("firstName"),
            lastName: formData.get("lastName"),
            consentStatus,
            consentSource,
          },
        }),
      });
      const data = await response.json() as Result;
      if (!response.ok) throw new Error(data.error || "Could not add contact.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add contact.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="flex flex-wrap items-center gap-2">
      <Link
        aria-disabled={!databaseConfigured}
        href={databaseConfigured ? "/imports" : "#"}
        className={`btn-secondary ${databaseConfigured ? "" : "pointer-events-none opacity-50"}`}
      >
        <FileUp className="h-4 w-4" /> Import CSV
      </Link>
      <button disabled={!databaseConfigured} onClick={() => { setMessage(""); setOpen(true); }} className="btn-primary">
        <Plus className="h-4 w-4" /> Add contact
      </button>
    </div>

    {open ? <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <section className="premium-panel w-full max-w-md p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">Audience</p><h2 className="mt-1 text-2xl font-black tracking-tight">Add contact</h2></div>
          <button aria-label="Close" onClick={() => setOpen(false)} className="btn-secondary !min-h-0 !p-2"><X className="h-5 w-5" /></button>
        </div>
        <form action={submitContact} className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-sm font-bold">Email</span><input required name="email" type="email" className={fieldClass} placeholder="name@company.com" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="mb-1.5 block text-sm font-bold">First name</span><input name="firstName" className={fieldClass} /></label>
            <label><span className="mb-1.5 block text-sm font-bold">Last name</span><input name="lastName" className={fieldClass} /></label>
          </div>
          <label className="block"><span className="mb-1.5 block text-sm font-bold">Consent status</span><select name="consentStatus" defaultValue="unconfirmed" className={fieldClass}><option value="unconfirmed">Unconfirmed</option><option value="confirmed">Confirmed opt-in</option></select></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold">Consent source</span><input name="consentSource" className={fieldClass} placeholder="Website signup / customer opt-in" /></label>
          {message ? <p className="text-sm font-semibold text-rose-600">{message}</p> : null}
          <button disabled={busy} className="btn-primary w-full">{busy ? "Saving…" : "Save contact"}</button>
        </form>
      </section>
    </div> : null}
  </>;
}
