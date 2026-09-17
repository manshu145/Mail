"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ImportLiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return null;
}
