"use client";

import { Code2, Eye, Maximize2, Monitor, Smartphone, Type, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

const HTML_BLOCKS = [
  {
    label: "Heading",
    value: '<h2 style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:26px;line-height:1.25;color:#111827">Your heading</h2>',
  },
  {
    label: "Paragraph",
    value: '<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:16px;line-height:1.7;color:#374151">Write your message here.</p>',
  },
  {
    label: "CTA",
    value: '<p style="margin:24px 0"><a href="https://example.com" style="display:inline-block;background:#6d5dfc;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;padding:13px 20px;border-radius:10px">Call to action</a></p>',
  },
  {
    label: "Divider",
    value: '<hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0">',
  },
  {
    label: "Image",
    value: '<img src="https://example.com/image.jpg" width="640" alt="Describe this image" style="display:block;width:100%;max-width:640px;height:auto;border:0;border-radius:12px">',
  },
];

type PreviewMode = "desktop" | "mobile";
type EditMode = "html" | "text";

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
  const [editMode, setEditMode] = useState<EditMode>("html");
  const [fullPreview, setFullPreview] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const sync = () => { if (query.matches) setPreviewMode("mobile"); };
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  const preview = useMemo(() => previewHtml(html), [html]);

  async function save(fd: FormData) {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: fd.get("name"), subject, htmlBody: html, textBody: text }),
      });
      const d = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) {
        setMsg(d.error || "Could not save");
        return;
      }
      setMsg("Saved");
      router.refresh();
    } catch {
      setMsg("Could not reach NexiMail. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function applyPreset(id: string) {
    const preset = EMAIL_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setSubject(preset.subject);
    setHtml(preset.htmlBody);
    setText(preset.textBody);
    setEditMode("html");
    setMsg("Preset loaded — save when ready");
  }

  function appendHtml(value: string) {
    setHtml((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${value}`);
  }

  function insertToken(token: string) {
    if (editMode === "html") appendHtml(token);
    else setText((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${token}`);
  }

  const previewFrame = (heightClass: string) => <div className={`mx-auto w-full overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-sm transition-all ${previewMode === "mobile" ? "max-w-[390px]" : "max-w-[760px]"}`}>
    <iframe title="Template preview" sandbox="" srcDoc={preview} className={`w-full bg-white ${heightClass}`} />
  </div>;

  return <>
    <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.08fr)_minmax(420px,.92fr)]">
      <div className="min-w-0 space-y-5">
        <form action={save} className="premium-panel overflow-hidden">
          <div className="border-b border-[var(--border)] p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div><p className="page-eyebrow">Editor</p><h2 className="mt-1 text-xl font-black">Template content</h2><p className="mt-1 text-xs text-[var(--muted)]">Compose HTML and plain-text fallback with live rendering beside the editor.</p></div>
              <label className="text-xs font-bold text-[var(--muted)]">Start from preset
                <select defaultValue="" onChange={(e) => { if (e.target.value) applyPreset(e.target.value); }} className="mt-1 block w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--foreground)] sm:w-auto">
                  <option value="">Choose preset</option>{EMAIL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-4 p-4 sm:p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-bold">Template name
                <input name="name" defaultValue={template.name} required className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 outline-none" />
              </label>
              <label className="text-sm font-bold">Default subject
                <input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 outline-none" />
                <span className="mt-1 block text-right text-[11px] font-semibold text-[var(--muted)]">{subject.length} characters</span>
              </label>
            </div>

            <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.05] p-3 text-[11px] leading-5 text-[var(--muted)]">
              <b>Personalization:</b> Imported custom fields work with the same token syntax. Use a fallback such as <code>{"{{first_name|Customer}}"}</code> so missing data does not leave awkward blanks.
            </div>

            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface-soft)] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 text-xs font-bold">
                  <button type="button" onClick={() => setEditMode("html")} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${editMode === "html" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : "text-[var(--muted)]"}`}><Code2 className="h-3.5 w-3.5"/> HTML</button>
                  <button type="button" onClick={() => setEditMode("text")} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${editMode === "text" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : "text-[var(--muted)]"}`}><Type className="h-3.5 w-3.5"/> Plain text</button>
                </div>
                <span className="text-[11px] font-bold text-[var(--muted)]">{editMode === "html" ? `${html.length.toLocaleString()} HTML characters` : `${text.length.toLocaleString()} text characters`}</span>
              </div>

              <div className="border-b border-[var(--border)] p-3">
                {editMode === "html" ? <div className="mb-3 flex flex-wrap gap-1.5">
                  <span className="mr-1 self-center text-[11px] font-black uppercase tracking-[.12em] text-[var(--muted)]">Blocks</span>
                  {HTML_BLOCKS.map((block) => <button key={block.label} type="button" onClick={() => appendHtml(block.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[11px] font-extrabold transition hover:border-violet-500/25 hover:text-violet-700 dark:hover:text-violet-300">{block.label}</button>)}
                </div> : null}
                <div className="flex flex-wrap gap-1.5">
                  <span className="mr-1 self-center text-[11px] font-black uppercase tracking-[.12em] text-[var(--muted)]">Tokens</span>
                  {TOKENS.map((token) => <button key={token} type="button" onClick={() => insertToken(token)} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-[11px] font-bold text-[var(--muted)] transition hover:border-violet-500/25 hover:text-[var(--foreground)]">{token}</button>)}
                </div>
              </div>

              {editMode === "html" ? <textarea aria-label="HTML body" name="htmlBody" value={html} onChange={(e) => setHtml(e.target.value)} rows={24} spellCheck={false} className="block min-h-[420px] w-full resize-y border-0 bg-[#0c1018] px-3.5 py-3 font-mono text-xs leading-5 text-zinc-100 outline-none sm:min-h-[520px]" />
                : <textarea aria-label="Plain-text fallback" name="textBody" value={text} onChange={(e) => setText(e.target.value)} rows={22} className="block min-h-[380px] w-full resize-y border-0 bg-[var(--surface)] px-3.5 py-3 text-sm leading-6 outline-none sm:min-h-[480px]" />}
            </div>
          </div>

          <div className="border-t border-[var(--border)] bg-[var(--surface-soft)] p-4 sm:p-5">
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-3.5 py-3 text-xs leading-5 text-[var(--muted)]">NexiMail adds one-click unsubscribe headers and a visible footer at send time. Add <code>{"{{unsubscribe_url}}"}</code> yourself when you want exact placement.</div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
              <button disabled={busy} className="btn-primary w-full sm:w-auto">{busy ? "Saving…" : "Save template"}</button>
              <button type="button" onClick={() => setFullPreview(true)} className="btn-secondary w-full sm:w-auto"><Eye className="h-4 w-4"/> Full preview</button>
              <span role="status" aria-live="polite" className={`text-xs font-bold ${msg === "Saved" || msg.startsWith("Preset") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span>
            </div>
          </div>
        </form>

        <TemplateAttachments templateId={template.id} initial={attachments} />
      </div>

      <section className="premium-panel min-w-0 overflow-hidden 2xl:sticky 2xl:top-[90px] 2xl:self-start">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
          <div className="min-w-0"><h2 className="font-black">Live preview</h2><p className="mt-1 truncate text-xs text-[var(--muted)]">{subject || "No subject yet"}</p></div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1">
              <button type="button" aria-label="Desktop preview" onClick={() => setPreviewMode("desktop")} className={`rounded-lg p-2 ${previewMode === "desktop" ? "bg-[var(--surface)] text-violet-600 shadow-sm" : "text-[var(--muted)]"}`}><Monitor className="h-4 w-4"/></button>
              <button type="button" aria-label="Mobile preview" onClick={() => setPreviewMode("mobile")} className={`rounded-lg p-2 ${previewMode === "mobile" ? "bg-[var(--surface)] text-violet-600 shadow-sm" : "text-[var(--muted)]"}`}><Smartphone className="h-4 w-4"/></button>
            </div>
            <button type="button" aria-label="Full screen preview" onClick={() => setFullPreview(true)} className="icon-button grid"><Maximize2 className="h-4 w-4"/></button>
          </div>
        </div>
        <div className="overflow-auto bg-[#e9edf5] p-3 sm:p-5">{previewFrame("h-[58dvh] min-h-[420px] sm:h-[650px] 2xl:h-[72dvh]")}</div>
      </section>
    </div>

    {fullPreview ? <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-2 backdrop-blur-sm sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="full-template-preview" className="flex max-h-[96dvh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div className="min-w-0"><p className="page-eyebrow">Full preview</p><h2 id="full-template-preview" className="truncate text-lg font-black">{subject || template.name}</h2></div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1">
              <button type="button" aria-label="Desktop preview" onClick={() => setPreviewMode("desktop")} className={`rounded-lg p-2 ${previewMode === "desktop" ? "bg-[var(--surface)] text-violet-600 shadow-sm" : "text-[var(--muted)]"}`}><Monitor className="h-4 w-4"/></button>
              <button type="button" aria-label="Mobile preview" onClick={() => setPreviewMode("mobile")} className={`rounded-lg p-2 ${previewMode === "mobile" ? "bg-[var(--surface)] text-violet-600 shadow-sm" : "text-[var(--muted)]"}`}><Smartphone className="h-4 w-4"/></button>
            </div>
            <button type="button" aria-label="Close full preview" onClick={() => setFullPreview(false)} className="icon-button grid"><X className="h-4 w-4"/></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#e9edf5] p-3 sm:p-6">{previewFrame("h-[82dvh]")}</div>
      </section>
    </div> : null}
  </>;
}
