"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const TOKENS = ["{{first_name}}", "{{last_name}}", "{{email}}", "{{unsubscribe_url}}"];

function previewHtml(html: string) {
  const sample = html
    .replaceAll("{{first_name}}", "Alex")
    .replaceAll("{{last_name}}", "Customer")
    .replaceAll("{{email}}", "alex@example.com")
    .replaceAll("{{unsubscribe_url}}", "#unsubscribe");
  if (/unsubscribe/i.test(sample)) return sample;
  return `${sample}<div style="margin-top:32px;padding-top:18px;border-top:1px solid #e5e7eb;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;text-align:center">A visible unsubscribe link is automatically added when NexiMail sends this template.</div>`;
}

export function TemplateEditor({ template }: { template: { id: string; name: string; subject: string | null; htmlBody: string; textBody: string } }) {
  const router = useRouter();
  const [html, setHtml] = useState(template.htmlBody);
  const [text, setText] = useState(template.textBody);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const preview = useMemo(() => previewHtml(html), [html]);

  async function save(fd: FormData) {
    setBusy(true); setMsg("");
    const r = await fetch(`/api/templates/${template.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: fd.get("name"), subject: fd.get("subject"), htmlBody: html, textBody: text }) });
    const d = await r.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!r.ok) return setMsg(d.error || "Could not save");
    setMsg("Saved"); router.refresh();
  }

  function insertHtml(token: string) { setHtml((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${token}`); }
  function insertText(token: string) { setText((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}${token}`); }

  return <div className="grid gap-5 xl:grid-cols-2">
    <form action={save} className="premium-panel p-5">
      <div className="grid gap-4">
        <label className="text-sm font-bold">Name<input name="name" defaultValue={template.name} required className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5" /></label>
        <label className="text-sm font-bold">Default subject<input name="subject" defaultValue={template.subject || ""} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5" /></label>
        <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-bold">HTML body</span><div className="flex flex-wrap gap-1.5">{TOKENS.map((token)=><button key={token} type="button" onClick={()=>insertHtml(token)} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-[10px] font-bold text-[var(--muted)] hover:text-[var(--foreground)]">{token}</button>)}</div></div><textarea name="htmlBody" value={html} onChange={e=>setHtml(e.target.value)} rows={16} spellCheck={false} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 font-mono text-xs outline-none" /></div>
        <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-bold">Plain-text body</span><div className="flex flex-wrap gap-1.5">{TOKENS.map((token)=><button key={token} type="button" onClick={()=>insertText(token)} className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-[10px] font-bold text-[var(--muted)] hover:text-[var(--foreground)]">{token}</button>)}</div></div><textarea name="textBody" value={text} onChange={e=>setText(e.target.value)} rows={8} className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm outline-none" /></div>
      </div>
      <div className="mt-4 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-3.5 py-3 text-xs leading-5 text-[var(--muted)]">Unsubscribe compliance is enforced automatically at send time. If <code>{"{{unsubscribe_url}}"}</code> is not present, NexiMail appends a visible unsubscribe footer and one-click unsubscribe headers.</div>
      <div className="mt-4 flex items-center gap-3"><button disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save template"}</button><span className={`text-xs font-bold ${msg === "Saved" ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span></div>
    </form>
    <section className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-4"><h2 className="font-black">Email preview</h2><p className="mt-1 text-xs text-[var(--muted)]">Personalization tokens use sample values here. Scripts stay disabled.</p></div><iframe title="Template preview" sandbox="" srcDoc={preview} className="h-[760px] w-full bg-white" /></section>
  </div>;
}
