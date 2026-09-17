"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EMAIL_PRESETS } from "@/lib/email-presets";
import { samplePersonalization } from "@/lib/personalization";
import { TemplateAttachments, type TemplateAttachmentView } from "@/components/template-attachments";

const TOKENS = [
  "{{name|Customer}}",
  "{{first_name|Customer}}",
  "{{last_name}}",
  "{{email}}",
  "{{city}}",
  "{{state}}",
  "{{district}}",
  "{{pincode}}",
  "{{category}}",
  "{{occupation}}",
  "{{industry}}",
  "{{unsubscribe_url}}",
];
type PreviewMode = "desktop" | "mobile";

function previewHtml(html: string) {
  const sample = samplePersonalization(html, "alex.customer@example.com").replaceAll("{{unsubscribe_url}}", "#unsubscribe");
  if (/unsubscribe/i.test(sample)) return sample;
  return `${sample}<div style="margin:32px auto 0;max-width:640px;padding:18px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;text-align:center">A visible unsubscribe link is automatically added when NexiMail sends this template.</div>`;
}

export function TemplateEditor({ template, attachments }: { template: { id: string; name: string; subject: string | null; htmlBody: string; textBody: string }; attachments: TemplateAttachmentView[] }) {
  const router = useRouter();
  const [html, setHtml] = useState(template.htmlBody);
  const [text, setText] = useState(template.textBody);
  const [subject, setSubject] = useState(template.subject || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const preview = useMemo(() => previewHtml(html), [html]);

  async function save(fd: FormData) {
    setBusy(true); setMsg("");
    const r = await fetch(`/api/templates/${template.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: fd.get("name"), subject, htmlBody: html, textBody: text }) });
    const d = await r.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!r.ok) return setMsg(d.error || "Could not save");
    setMsg("Saved"); router.refresh();
  }

  function applyPreset(id: string) {
    const preset = EMAIL_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setSubject(preset.subject); setHtml(preset.htmlBody); setText(preset.textBody); setMsg("Preset loaded — save when ready");
  }
  function insertHtml(token: string) { setHtml((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${token}`); }
  function insertText(token: string) { setText((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${token}`); }

  return <div className="grid gap-5 xl:grid-cols-[1.04fr_.96fr]">
    <div className="space-y-5">
      <form action={save} className="premium-panel overflow-hidden">
        <div className="border-b border-[var(--border)] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="page-eyebrow">Editor</p><h2 className="mt-1 text-xl font-black">Template content</h2></div><label className="text-xs font-bold text-[var(--muted)]">Start from preset<select defaultValue="" onChange={(e)=>{if(e.target.value)applyPreset(e.target.value)}} className="mt-1 block rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--foreground)]"><option value="">Choose preset</option>{EMAIL_PRESETS.map((preset)=><option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label></div></div>
        <div className="grid gap-4 p-5">
          <label className="text-sm font-bold">Template name<input name="name" defaultValue={template.name} required className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 outline-none" /></label>
          <label className="text-sm font-bold">Default subject<input name="subject" value={subject} onChange={(e)=>setSubject(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 outline-none" /></label>
          <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.05] p-3 text-[11px] leading-5 text-[var(--muted)]"><b>Personalization:</b> Imported custom fields are usable with the same token syntax. Add a fallback with <code>{"{{first_name|Customer}}"}</code> so missing data never leaves an awkward blank.</div>
          <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><span className="text-sm font-bold">HTML body</span><p className="text-[11px] text-[var(--muted)]">Paste production email HTML or start from a preset.</p></div><div className="flex max-w-full flex-wrap gap-1.5">{TOKENS.map((token)=><button key={token} type="button" onClick={()=>insertHtml(token)} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-[10px] font-bold text-[var(--muted)] hover:text-[var(--foreground)]">{token}</button>)}</div></div><textarea name="htmlBody" value={html} onChange={e=>setHtml(e.target.value)} rows={22} spellCheck={false} className="w-full resize-y rounded-xl border border-[var(--border-strong)] bg-[#0c1018] px-3.5 py-3 font-mono text-xs leading-5 text-zinc-100 outline-none" /></div>
          <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><span className="text-sm font-bold">Plain-text fallback</span><p className="text-[11px] text-[var(--muted)]">Shown when HTML is unavailable.</p></div><div className="flex max-w-full flex-wrap gap-1.5">{TOKENS.map((token)=><button key={token} type="button" onClick={()=>insertText(token)} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-[10px] font-bold text-[var(--muted)] hover:text-[var(--foreground)]">{token}</button>)}</div></div><textarea name="textBody" value={text} onChange={e=>setText(e.target.value)} rows={9} className="w-full resize-y rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm leading-6 outline-none" /></div>
        </div>
        <div className="border-t border-[var(--border)] bg-[var(--surface-soft)] p-5"><div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-3.5 py-3 text-xs leading-5 text-[var(--muted)]">NexiMail adds one-click unsubscribe headers and a visible footer at send time. Add <code>{"{{unsubscribe_url}}"}</code> yourself when you want to control its exact position.</div><div className="mt-4 flex flex-wrap items-center gap-3"><button disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save template"}</button><span className={`text-xs font-bold ${msg === "Saved" || msg.startsWith("Preset") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span></div></div>
      </form>
      <TemplateAttachments templateId={template.id} initial={attachments}/>
    </div>

    <section className="premium-panel overflow-hidden xl:sticky xl:top-[90px] xl:self-start"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4"><div><h2 className="font-black">Live preview</h2><p className="mt-1 text-xs text-[var(--muted)]">Sample personalization values are rendered here with the same engine used during sending.</p></div><div className="flex rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1 text-xs font-bold"><button type="button" onClick={()=>setPreviewMode("desktop")} className={`rounded-lg px-3 py-1.5 ${previewMode==="desktop"?"bg-[var(--surface)] shadow-sm":"text-[var(--muted)]"}`}>Desktop</button><button type="button" onClick={()=>setPreviewMode("mobile")} className={`rounded-lg px-3 py-1.5 ${previewMode==="mobile"?"bg-[var(--surface)] shadow-sm":"text-[var(--muted)]"}`}>Mobile</button></div></div><div className="bg-[#e9edf5] p-4 sm:p-6"><div className={`mx-auto overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm transition-all ${previewMode==="mobile"?"max-w-[390px]":"max-w-[760px]"}`}><iframe title="Template preview" sandbox="" srcDoc={preview} className="h-[760px] w-full bg-white" /></div></div></section>
  </div>;
}
