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
    <div className="flex h-full flex-col bg-white dark:bg-slate-950">
      <div className="px-5 pb-5 pt-6"><BrandMark /></div>
      <div className="px-3">
        <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Workspace</div>
        <nav className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"}`}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900">{session.name.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{session.name}</div>
              <div className="truncate text-xs capitalize text-slate-500">{session.role}</div>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </div>
          <form action="/api/auth/logout" method="post" className="mt-3">
            <button className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" type="submit">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950 dark:bg-[#070b14] dark:text-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] border-r border-slate-200 lg:block dark:border-slate-800">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close navigation" className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-[288px] max-w-[86vw] border-r border-slate-200 shadow-2xl dark:border-slate-800">
            <button aria-label="Close navigation" className="absolute right-3 top-3 z-10 rounded-lg p-2 text-slate-500" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-[268px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200/80 bg-slate-50/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8 dark:border-slate-800 dark:bg-[#070b14]/90">
          <div className="flex items-center gap-3">
            <button aria-label="Open navigation" className="rounded-xl border border-slate-200 bg-white p-2 lg:hidden dark:border-slate-800 dark:bg-slate-950" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
            <div className="lg:hidden"><BrandMark compact /></div>
            <div className="hidden text-sm font-semibold text-slate-500 sm:block">NexiMail control plane</div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> PWA online
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
