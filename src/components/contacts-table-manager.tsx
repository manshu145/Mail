"use client";

import Link from "next/link";
import { Archive, CheckSquare2, ListPlus, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type ContactRow = {
  id: string;
  email: string;
  name: string;
  hasName: boolean;
  status: "active" | "archived";
  validationStatus: string;
  source: string;
  createdAt: string;
};

type ListOption = { id: string; name: string };
type SegmentOption = { id: string; name: string };

type BulkAction = "add_to_list" | "remove_from_list" | "archive" | "restore" | "delete";

export function ContactsTableManager({
  rows,
  lists,
  dynamicSegments,
}: {
  rows: ContactRow[];
  lists: ListOption[];
  dynamicSegments: SegmentOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const selectedCount = selectedRows.length;
  const hasArchived = selectedRows.some((row) => row.status === "archived");
  const hasActive = selectedRows.some((row) => row.status === "active");

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMessage("");
    setError("");
  }

  function toggleAll() {
    setSelected((current) => {
      if (rows.length && rows.every((row) => current.has(row.id))) return new Set();
      return new Set(rows.map((row) => row.id));
    });
    setMessage("");
    setError("");
  }

  async function run(action: BulkAction, ids = [...selected]) {
    if (!ids.length || busy) return;
    if ((action === "add_to_list" || action === "remove_from_list") && !listId) {
      setError("Choose a static list first.");
      return;
    }
    if (action === "delete" && !window.confirm(`Permanently delete ${ids.length} contact${ids.length === 1 ? "" : "s"}? Contacts with campaign history will be protected and cannot be deleted.`)) return;
    if (action === "archive" && !window.confirm(`Archive ${ids.length} selected contact${ids.length === 1 ? "" : "s"}?`)) return;

    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactIds: ids, action, listId: listId || undefined }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; count?: number; listName?: string };
      if (!response.ok) {
        setError(data.error || "Contact action failed.");
        return;
      }
      const count = data.count ?? ids.length;
      const copy: Record<BulkAction, string> = {
        add_to_list: `Added ${count} contact${count === 1 ? "" : "s"} to ${data.listName || "list"}.`,
        remove_from_list: `Removed ${count} contact${count === 1 ? "" : "s"} from ${data.listName || "list"}.`,
        archive: `Archived ${count} contact${count === 1 ? "" : "s"}.`,
        restore: `Restored ${count} contact${count === 1 ? "" : "s"}.`,
        delete: `Deleted ${count} contact${count === 1 ? "" : "s"}.`,
      };
      setMessage(copy[action]);
      setSelected(new Set());
      router.refresh();
    } catch {
      setError("Could not confirm the contact action. Check connectivity and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(id: string, email: string) {
    if (!window.confirm(`Delete ${email}? Contacts with campaign history are protected; archive them instead.`)) return;
    await run("delete", [id]);
  }

  return <div>
    <div className="border-b border-[var(--border)] bg-[linear-gradient(90deg,rgba(109,93,252,.055),transparent)] px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleAll} className="btn-secondary !min-h-9 !px-3 !py-2 text-xs">
            <CheckSquare2 className="h-3.5 w-3.5" /> {allSelected ? "Clear visible" : "Select visible"}
          </button>
          <span className="status-pill">{selectedCount ? `${selectedCount} selected` : "Select contacts to manage"}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={listId} onChange={(e) => setListId(e.target.value)} disabled={busy || !selectedCount} className="h-9 min-w-[180px] rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-xs font-bold outline-none disabled:opacity-45">
            <option value="">Choose static list</option>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
          <button type="button" disabled={busy || !selectedCount || !listId} onClick={() => run("add_to_list")} className="btn-secondary !min-h-9 !px-3 !py-2 text-xs"><ListPlus className="h-3.5 w-3.5"/> Add to list</button>
          <button type="button" disabled={busy || !selectedCount || !listId} onClick={() => run("remove_from_list")} className="btn-secondary !min-h-9 !px-3 !py-2 text-xs">Remove from list</button>
          {hasActive ? <button type="button" disabled={busy || !selectedCount} onClick={() => run("archive")} className="btn-secondary !min-h-9 !px-3 !py-2 text-xs"><Archive className="h-3.5 w-3.5"/> Archive</button> : null}
          {hasArchived ? <button type="button" disabled={busy || !selectedCount} onClick={() => run("restore")} className="btn-secondary !min-h-9 !px-3 !py-2 text-xs"><RotateCcw className="h-3.5 w-3.5"/> Restore</button> : null}
          <button type="button" disabled={busy || !selectedCount} onClick={() => run("delete")} className="btn-danger !min-h-9 !px-3 !py-2 text-xs"><Trash2 className="h-3.5 w-3.5"/> Delete</button>
        </div>
      </div>

      {dynamicSegments.length ? <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
        Dynamic segments are rule-based and update automatically, so contacts cannot be manually inserted into them. Available: {dynamicSegments.map((x) => x.name).join(", ")}.
      </p> : null}
      {message ? <p role="status" className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs font-bold text-rose-600">{error}</p> : null}
    </div>

    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-[var(--surface-soft)] text-[11px] font-black uppercase tracking-[.12em] text-[var(--muted)]">
          <tr>
            <th className="w-12 px-5 py-3.5"><input aria-label="Select all visible contacts" type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
            <th className="py-3.5">Contact</th><th>Status</th><th>Validation</th><th>Source</th><th>Added</th><th className="pr-5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((contact) => {
            const checked = selected.has(contact.id);
            return <tr key={contact.id} className={`transition ${checked ? "bg-violet-500/[0.045]" : "hover:bg-[var(--surface-soft)]"}`}>
              <td className="px-5 py-4"><input aria-label={`Select ${contact.email}`} type="checkbox" checked={checked} onChange={() => toggle(contact.id)} /></td>
              <td className="py-4">
                <Link href={`/contacts/${contact.id}`} className="font-black hover:text-violet-700 dark:hover:text-violet-300">{contact.name}</Link>
                {contact.hasName ? <div className="mt-0.5 text-xs text-[var(--muted)]">{contact.email}</div> : <div className="mt-0.5 text-[11px] text-[var(--muted)]">Email-only contact · no name supplied</div>}
              </td>
              <td className="capitalize"><span className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1 text-[11px] font-bold">{contact.status}</span></td>
              <td className="capitalize text-xs font-bold text-[var(--muted)]">{contact.validationStatus}</td>
              <td className="text-xs text-[var(--muted)]">{contact.source.replaceAll("_"," ")}</td>
              <td className="text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(contact.createdAt))}</td>
              <td className="pr-5">
                <div className="flex justify-end gap-2">
                  <Link href={`/contacts/${contact.id}`} className="btn-secondary !min-h-8 !px-2.5 !py-1 text-xs">Edit</Link>
                  <button type="button" disabled={busy} onClick={() => deleteOne(contact.id, contact.email)} className="btn-danger !min-h-8 !px-2.5 !py-1 text-xs">Delete</button>
                </div>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}
