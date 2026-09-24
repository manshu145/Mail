"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "pause" | "resume" | "retry_failed" | "cancel";

export function CampaignControl({ id, status, failed = 0 }: { id: string; status: string; failed?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");

  async function run(action: Action) {
    if (action === "cancel" && !confirm("Cancel this campaign? Messages already accepted by the MTA cannot be recalled.")) return;
    if (action === "retry_failed" && !confirm(`Retry eligible failed recipients? Messages with uncertain or previously accepted delivery will be excluded.`)) return;
    setBusy(action);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${id}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Campaign action failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not confirm the campaign action. Refresh to check its status before retrying.");
    } finally {
      setBusy(null);
    }
  }

  const terminal = ["cancelled"].includes(status);
  if (terminal) return null;

  return <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
    {status === "paused" ? <button disabled={!!busy} className="btn-primary" onClick={() => run("resume")}>{busy === "resume" ? "Resuming…" : "Resume"}</button> : null}
    {["queued", "scheduled", "sending"].includes(status) ? <button disabled={!!busy} className="btn-secondary" onClick={() => run("pause")}>{busy === "pause" ? "Pausing…" : "Pause"}</button> : null}
    {failed > 0 && status !== "cancelled" ? <button disabled={!!busy} className="btn-secondary" onClick={() => run("retry_failed")}>{busy === "retry_failed" ? "Retrying…" : `Retry eligible (${failed})`}</button> : null}
    {status !== "completed" ? <button disabled={!!busy} className="btn-danger" onClick={() => run("cancel")}>{busy === "cancel" ? "Cancelling…" : "Cancel"}</button> : null}
    {error ? <span role="alert" className="basis-full text-right text-xs font-semibold text-rose-600">{error}</span> : null}
  </div>;
}
