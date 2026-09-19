"use client";

import { Eye, Monitor, Smartphone, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { EMAIL_PRESETS } from "@/lib/email-presets";
import { samplePersonalization } from "@/lib/personalization";

type PreviewMode = "desktop" | "mobile";

function renderPreview(html: string) {
  return samplePersonalization(html, "alex.customer@example.com").replaceAll("{{unsubscribe_url}}", "#unsubscribe");
}

export function TemplatePresetLibrary() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const previewPreset = useMemo(() => EMAIL_PRESETS.find((item) => item.id === previewId) || null, [previewId]);

  async function createFromPreset(id: string) {
    const preset = EMAIL_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setBusy(id); setError("");
    try {
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
      if (!response.ok || !data.id) {
        setError(data.error || "Could not create template.");
        return;
      }
      setPreviewId(null);
      router.push(`/templates/${data.id}`);
      router.refresh();
    } catch {
      setError("Could not create template. Check connectivity and try again.");
    } finally {
      setBusy(null);
    }
  }

  return <section className="mb-7">
    <div className="mb-3 flex items-end justify-between gap-3">
      <div><p className="page-eyebrow">Starter library</p><h2 className="mt-1 text-xl font-black">Prebuilt templates</h2></div>
      <p className="hidden text-xs text-[var(--muted)] sm:block">Preview first. Customize after.</p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {EMAIL_PRESETS.map((preset) => <article key={preset.id} className="premium-panel group p-4">
        <button type="button" onClick={() => { setPreviewMode("desktop"); setPreviewId(preset.id); }} className="relative mb-3 block h-24 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-white p-3 text-left text-[9px] text-zinc-600 transition group-hover:border-violet-500/25">
          <div className="h-3 w-16 rounded bg-violet-200" /><div className="mt-2 h-2 w-4/5 rounded bg-zinc-200" /><div className="mt-1 h-2 w-3/5 rounded bg-zinc-100" /><div className="mt-3 h-4 w-20 rounded bg-violet-500" />
          <span className="absolute inset-0 grid place-items-center bg-zinc-950/0 opacity-0 transition group-hover:bg-zinc-950/25 group-hover:opacity-100"><span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-extrabold text-zinc-900 shadow-lg"><Eye className="h-3.5 w-3.5"/> Preview</span></span>
        </button>
        <h3 className="text-sm font-black">{preset.name}</h3>
        <p className="mt-1 min-h-10 text-[11px] leading-5 text-[var(--muted)]">{preset.description}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setPreviewMode("desktop"); setPreviewId(preset.id); }} className="btn-secondary !min-h-9 !px-3 text-xs"><Eye className="h-3.5 w-3.5"/> Preview</button>
          <button type="button" disabled={busy !== null} onClick={() => createFromPreset(preset.id)} className="btn-primary !min-h-9 !px-3 text-xs">{busy === preset.id ? "Creating…" : "Use template"}</button>
        </div>
      </article>)}
    </div>

    {error ? <p role="alert" className="mt-3 rounded-xl border border-rose-500/15 bg-rose-500/[0.06] px-3.5 py-3 text-sm font-semibold text-rose-600">{error}</p> : null}

    {previewPreset ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="preset-preview-title" className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div className="min-w-0"><p className="page-eyebrow">Template preview</p><h3 id="preset-preview-title" className="truncate text-lg font-black">{previewPreset.name}</h3><p className="truncate text-xs text-[var(--muted)]">{previewPreset.subject}</p></div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1">
              <button type="button" aria-label="Desktop preview" onClick={() => setPreviewMode("desktop")} className={`rounded-lg p-2 ${previewMode === "desktop" ? "bg-[var(--surface)] text-violet-600 shadow-sm" : "text-[var(--muted)]"}`}><Monitor className="h-4 w-4"/></button>
              <button type="button" aria-label="Mobile preview" onClick={() => setPreviewMode("mobile")} className={`rounded-lg p-2 ${previewMode === "mobile" ? "bg-[var(--surface)] text-violet-600 shadow-sm" : "text-[var(--muted)]"}`}><Smartphone className="h-4 w-4"/></button>
            </div>
            <button type="button" aria-label="Close preview" onClick={() => setPreviewId(null)} className="icon-button grid"><X className="h-4 w-4"/></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#e9edf5] p-3 sm:p-6">
          <div className={`mx-auto overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-lg transition-all ${previewMode === "mobile" ? "max-w-[390px]" : "max-w-[760px]"}`}>
            <iframe title={`${previewPreset.name} preview`} sandbox="" srcDoc={renderPreview(previewPreset.htmlBody)} className="h-[68dvh] w-full bg-white sm:h-[72dvh]" />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-end sm:p-4">
          <button type="button" onClick={() => setPreviewId(null)} className="btn-secondary">Close</button>
          <button type="button" disabled={busy !== null} onClick={() => createFromPreset(previewPreset.id)} className="btn-primary">{busy === previewPreset.id ? "Creating…" : "Use this template"}</button>
        </div>
      </section>
    </div> : null}
  </section>;
}
