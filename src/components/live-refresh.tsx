"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function LiveRefresh({ intervalMs = 10000, label = "Live" }: { intervalMs?: number; label?: string }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;

    const tick = () => {
      if (stopped || document.visibilityState !== "visible") return;
      setRefreshing(true);
      router.refresh();
      window.setTimeout(() => { if (!stopped) setRefreshing(false); }, 700);
    };

    const start = () => {
      if (timer) window.clearInterval(timer);
      timer = window.setInterval(tick, Math.max(5000, intervalMs));
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, router]);

  return <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/[0.06] px-2.5 py-1 text-[11px] font-black uppercase tracking-[.08em] text-emerald-700 dark:text-emerald-300">
    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/>
    {label}
    <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}/>
  </span>;
}
