"use client";

import { Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

export type TemplateAttachmentView = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function TemplateAttachments({ templateId, initial }: { templateId: string; initial: TemplateAttachmentView[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true); setError("");
    const form = new FormData(); form.append("file", file);
    const response = await fetch(`/api/templates/${templateId}/attachments`, { method: "POST", body: form });
    const data = await response.json().catch(() => ({})) as { error?: string; attachment?: TemplateAttachmentView };
    setBusy(false);
    if (!response.ok || !data.attachment) { setError(data.error || "Attachment upload failed."); return; }
    setItems((current) => [...current, data.attachment!]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(id: string) {
    setBusy(true); setError("");
    const response = await fetch(`/api/templates/${templateId}/attachments`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ attachmentId: id }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error || "Could not remove attachment."); return; }
    setItems((current) => current.filter((item) => item.id !== id));
  }

  const total = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  return <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex items-center gap-2"><Paperclip className="h-4 w-4"/><p className="text-sm font-extrabold">Default attachments</p></div><p className="mt-1 text-xs text-[var(--muted)]">These files are automatically included whenever this template is used. PDF, CSV, images, Word or Excel · up to 5 files.</p></div>
      <label className={`btn-secondary cursor-pointer ${busy || items.length >= 5 ? "pointer-events-none opacity-50" : ""}`}><Upload className="mr-2 inline h-4 w-4"/>{busy ? "Uploading…" : "Add attachment"}<input ref={inputRef} className="hidden" type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx" disabled={busy || items.length >= 5} onChange={(event)=>{const file=event.target.files?.[0];if(file)void upload(file)}}/></label>
    </div>
    {items.length ? <div className="mt-4 space-y-2">{items.map((item)=><div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{item.filename}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{sizeLabel(item.sizeBytes)} · {item.contentType}</p></div><button type="button" disabled={busy} onClick={()=>void remove(item.id)} className="rounded-lg p-2 text-rose-500 hover:bg-rose-500/10" aria-label={`Remove ${item.filename}`}><Trash2 className="h-4 w-4"/></button></div>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-5 text-center text-sm text-[var(--muted)]">No default attachments.</div>}
    <div className="mt-3 text-right text-xs font-semibold text-[var(--muted)]">{items.length}/5 files · {sizeLabel(total)} total</div>
    {error ? <p className="mt-3 rounded-xl border border-rose-500/15 bg-rose-500/[0.06] px-3.5 py-3 text-sm font-semibold text-rose-600">{error}</p> : null}
  </div>;
}
