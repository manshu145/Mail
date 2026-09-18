type MessageStatus =
  | "queued"
  | "ready_for_transport"
  | "sending"
  | "mta_accepted"
  | "deferred"
  | "delivered"
  | "bounced"
  | "failed"
  | "cancelled"
  | string;

const styles: Record<string, string> = {
  queued: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ready_for_transport: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  sending: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  mta_accepted: "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  deferred: "border-orange-500/20 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  delivered: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  bounced: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  failed: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cancelled: "border-zinc-500/20 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

const labels: Record<string, string> = {
  queued: "Queued",
  ready_for_transport: "Queued",
  sending: "Sending",
  mta_accepted: "MTA accepted",
  deferred: "Deferred",
  delivered: "Delivered",
  bounced: "Bounced",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function MessageStatusBadge({ status, compact = false }: { status: MessageStatus; compact?: boolean }) {
  const key = String(status || "").toLowerCase();
  return <span className={`inline-flex items-center rounded-full border font-extrabold capitalize ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"} ${styles[key] || "border-zinc-500/20 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"}`}>
    {labels[key] || key.replaceAll("_", " ")}
  </span>;
}
