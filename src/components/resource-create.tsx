"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ModalPortal } from "@/components/modal-portal";

type Option = string | { label: string; value: string };
type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "textarea" | "select";
  required?: boolean;
  placeholder?: string;
  options?: Option[];
};

export function ResourceCreate({
  endpoint,
  title,
  buttonLabel,
  submitLabel,
  redirectBasePath,
  fields,
  disabled = false,
}: {
  endpoint: string;
  title: string;
  buttonLabel: string;
  submitLabel?: string;
  redirectBasePath?: string;
  fields: Field[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setBusy(true);
    setError("");
    try {
      const body = Object.fromEntries(formData.entries());
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; id?: string };
      if (!response.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      setOpen(false);
      if (redirectBasePath && data.id) {
        router.push(`${redirectBasePath}/${data.id}`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach NexiMail. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setError("");
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy]);

  return <>
    <button type="button" disabled={disabled} className="btn-primary" onClick={() => { setError(""); setOpen(true); }}>
      <Plus className="h-4 w-4" />{buttonLabel}
    </button>
    {open ? <ModalPortal><div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/55 p-3 py-4 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="resource-create-title" aria-describedby="resource-create-description" className="premium-panel flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden sm:max-h-[calc(100dvh-3rem)]">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <p id="resource-create-description" className="text-xs font-extrabold uppercase tracking-[.16em] text-[var(--muted)]">NexiMail</p>
            <h2 id="resource-create-title" className="mt-1 text-2xl font-black tracking-tight">{title}</h2>
          </div>
          <button type="button" aria-label="Close dialog" disabled={busy} className="btn-secondary !min-h-0 !p-2" onClick={close}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form action={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="modal-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
            {fields.map((field, index) => <label className="block" key={field.name}>
              <span className="mb-1.5 block text-sm font-bold">{field.label}</span>
              {field.type === "textarea" ? <textarea name={field.name} required={field.required} placeholder={field.placeholder} rows={5} autoFocus={index === 0} className="form-control" />
                : field.type === "select" ? <select name={field.name} required={field.required} autoFocus={index === 0} className="form-control">
                  {field.options?.map((option) => { const x = typeof option === "string" ? { label: option, value: option } : option; return <option value={x.value} key={x.value}>{x.label}</option>; })}
                </select>
                : <input name={field.name} required={field.required} placeholder={field.placeholder} type={field.type || "text"} autoFocus={index === 0} autoComplete={field.type === "password" ? "new-password" : undefined} className="form-control" />}
            </label>)}
            {error ? <p role="alert" aria-live="polite" className="text-sm font-semibold text-rose-600">{error}</p> : null}
          </div>
          <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:px-6">
            <button disabled={busy} className="btn-primary w-full">{busy ? "Saving…" : (submitLabel || buttonLabel)}</button>
          </div>
        </form>
      </section>
    </div></ModalPortal> : null}
  </>;
}
