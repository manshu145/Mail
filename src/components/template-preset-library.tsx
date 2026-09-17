"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EMAIL_PRESETS } from "@/lib/email-presets";

export function TemplatePresetLibrary() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function createFromPreset(id: string) {
    const preset = EMAIL_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setBusy(id); setError("");
    const response = await fetch("/api/resources/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `${preset.name} ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
        subject: preset.subject,
        htmlBody: preset.htmlBody,
        textBody: preset.textBody,
      }),
    });
    const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
    setBusy(null);
    if (!response.ok || !data.id) return setError(data.error || "Could not create template.");
    router.push(`/templates/${data.id}`);
    router.refresh();
  }

  return <section className="mb-7">
    <div className="mb-3 flex items-end justify-between gap-3"><div><p className="page-eyebrow">Starter library</p><h2 className="mt-1 text-xl font-black">Prebuilt templates</h2></div><p className="hidden text-xs text-[var(--muted)] sm:block">Create, customize and send.</p></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {EMAIL_PRESETS.map((preset) => <article key={preset.id} className="premium-panel p-4">
        <div className="mb-3 h-20 overflow-hidden rounded-xl border border-[var(--border)] bg-white p-3 text-[9px] text-zinc-600">
          <div className="h-3 w-16 rounded bg-violet-200" /><div className="mt-2 h-2 w-4/5 rounded bg-zinc-200" /><div className="mt-1 h-2 w-3/5 rounded bg-zinc-100" /><div className="mt-3 h-4 w-20 rounded bg-violet-500" />
        </div>
        <h3 className="text-sm font-black">{preset.name}</h3>
        <p className="mt-1 min-h-10 text-[11px] leading-5 text-[var(--muted)]">{preset.description}</p>
        <button type="button" disabled={busy !== null} onClick={()=>createFromPreset(preset.id)} className="btn-secondary mt-3 w-full">{busy === preset.id ? "Creating…" : "Use template"}</button>
      </article>)}
    </div>
    {error ? <p className="mt-3 rounded-xl border border-rose-500/15 bg-rose-500/[0.06] px-3.5 py-3 text-sm font-semibold text-rose-600">{error}</p> : null}
  </section>;
}
