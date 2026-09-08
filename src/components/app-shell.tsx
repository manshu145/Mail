"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  ChevronDown,
  ContactRound,
  Gauge,
  Layers3,
  Mail,
  Menu,
  Send,
  ServerCog,
  Settings,
  ShieldBan,
  X,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { PwaStatus } from "./pwa-status";
import { ThemeToggle } from "./theme-toggle";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/contacts", label: "Contacts", icon: ContactRound },
  { href: "/lists", label: "Lists & segments", icon: Layers3 },
  { href: "/validation", label: "Validation", icon: ShieldBan },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/templates", label: "Templates", icon: Mail },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/infrastructure", label: "Infrastructure", icon: ServerCog },
  { href: "/suppressions", label: "Suppressions", icon: ShieldBan },
  { href: "/system-health", label: "System health", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

type SessionView = { name: string; email: string; role: "owner" | "admin" | "operator" };

export function AppShell({ session, children }: { session: SessionView; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col bg-[#fbfaf8] dark:bg-[#111112]">
      <div className="px-5 pb-5 pt-6"><BrandMark /></div>
      <div className="px-3">
        <div className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">Workspace</div>
        <nav className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950" : "text-zinc-600 hover:bg-black/[0.035] hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.055] dark:hover:text-white"}`}>
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} /> {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto border-t border-black/[0.06] p-3 dark:border-white/[0.07]">
        <div className="rounded-2xl border border-black/[0.05] bg-white/75 p-3 shadow-[0_1px_3px_rgba(0,0,0,.03)] dark:border-white/[0.07] dark:bg-white/[0.035]">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-zinc-800 to-zinc-950 text-xs font-bold text-white ring-1 ring-black/10 dark:from-zinc-200 dark:to-white dark:text-zinc-950">{session.name.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-zinc-950 dark:text-white">{session.name}</div><div className="truncate text-xs capitalize text-zinc-500">{session.role}</div></div>
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          </div>
          <form action="/api/auth/logout" method="post" className="mt-3"><button className="w-full rounded-lg border border-black/[0.07] px-3 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.05]" type="submit">Sign out</button></form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#f6f5f2] text-zinc-950 dark:bg-[#0d0d0e] dark:text-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] border-r border-black/[0.06] lg:block dark:border-white/[0.07]">{sidebar}</aside>
      {open && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close navigation" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setOpen(false)} /><aside className="relative h-full w-[288px] max-w-[86vw] border-r border-black/[0.08] shadow-2xl dark:border-white/[0.08]"><button aria-label="Close navigation" className="absolute right-3 top-3 z-10 rounded-lg p-2 text-zinc-500" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>{sidebar}</aside></div>}
      <div className="lg:pl-[268px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-black/[0.055] bg-[#f6f5f2]/88 px-4 backdrop-blur-xl sm:px-6 lg:px-8 dark:border-white/[0.065] dark:bg-[#0d0d0e]/88">
          <div className="flex items-center gap-3"><button aria-label="Open navigation" className="rounded-xl border border-black/[0.07] bg-white p-2 lg:hidden dark:border-white/[0.08] dark:bg-[#171718]" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button><div className="lg:hidden"><BrandMark compact /></div><div className="hidden text-sm font-semibold text-zinc-500 sm:block">NexiMail control plane</div></div>
          <div className="flex items-center gap-2"><PwaStatus /><ThemeToggle /></div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
