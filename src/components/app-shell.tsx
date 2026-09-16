"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Blocks,
  ChevronDown,
  CircleGauge,
  ContactRound,
  FileUp,
  Gauge,
  Globe2,
  History,
  Inbox,
  KeyRound,
  Layers3,
  ListOrdered,
  Mail,
  MailCheck,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  ServerCog,
  Settings,
  ShieldBan,
  Sparkles,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { PwaStatus } from "./pwa-status";
import { ThemeToggle } from "./theme-toggle";

type SessionView = { name: string; email: string; role: "owner" | "admin" | "operator" };

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: Gauge }],
  },
  {
    label: "Audience",
    items: [
      { href: "/contacts", label: "Contacts", icon: ContactRound },
      { href: "/lists", label: "Lists", icon: Layers3 },
      { href: "/segments", label: "Segments", icon: Blocks },
      { href: "/imports", label: "Imports", icon: FileUp },
      { href: "/validation", label: "Validation", icon: MailCheck },
    ],
  },
  {
    label: "Messaging",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Send },
      { href: "/templates", label: "Templates", icon: Mail },
      { href: "/messages", label: "Message log", icon: ListOrdered },
      { href: "/queue", label: "Delivery queue", icon: CircleGauge },
    ],
  },
  {
    label: "Deliverability",
    items: [
      { href: "/domains", label: "Sending domains", icon: Globe2 },
      { href: "/sender-identities", label: "Sender identities", icon: Network },
      { href: "/inbox-placement", label: "Inbox placement", icon: Inbox },
      { href: "/suppressions", label: "Suppressions", icon: ShieldBan },
      { href: "/reports", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/infrastructure", label: "Infrastructure", icon: ServerCog },
      { href: "/api-keys", label: "API keys", icon: KeyRound },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/users", label: "Team access", icon: Users },
      { href: "/audit-log", label: "Audit log", icon: History },
      { href: "/system-health", label: "System health", icon: Activity },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NM";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function AppShell({ session, children }: { session: SessionView; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const current = useMemo(() => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item;
      }
    }
    return navGroups[0].items[0];
  }, [pathname]);

  const sidebar = (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--sidebar)] text-[var(--sidebar-fg)]">
      <div className={`flex h-[76px] items-center border-b border-white/[0.07] ${collapsed ? "justify-center px-3" : "px-5"}`}>
        <BrandMark compact={collapsed} inverse />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-5 last:mb-2">
            {!collapsed && (
              <div className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                {group.label}
              </div>
            )}
            <nav className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={`group relative flex h-10 items-center rounded-xl transition-all duration-200 ${collapsed ? "justify-center px-2" : "gap-3 px-3"} ${active ? "bg-white text-[#111318] shadow-[0_10px_28px_rgba(0,0,0,.18)]" : "text-white/62 hover:bg-white/[0.065] hover:text-white"}`}
                  >
                    {active && <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-[#7c5cff]" />}
                    <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                    {!collapsed && <span className="truncate text-[13px] font-bold">{item.label}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      <div className="border-t border-white/[0.07] p-3">
        {!collapsed && (
          <div className="mb-3 rounded-2xl border border-white/[0.08] bg-white/[0.045] p-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
              <Sparkles className="h-3.5 w-3.5" /> Control plane
            </div>
            <p className="text-[11px] leading-5 text-white/55">Self-hosted sending infrastructure with your data under your control.</p>
          </div>
        )}
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#7c5cff] to-[#4b7cff] text-[11px] font-black text-white shadow-lg shadow-violet-950/30">
            {initials(session.name)}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-extrabold text-white">{session.name}</div>
                <div className="truncate text-[11px] capitalize text-white/40">{session.role}</div>
              </div>
              <ChevronDown className="h-4 w-4 text-white/30" />
            </>
          )}
        </div>
        {!collapsed && (
          <form action="/api/auth/logout" method="post" className="mt-3">
            <button className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/65 transition hover:bg-white/[0.08] hover:text-white">
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-black/[0.05] transition-[width] duration-300 lg:block dark:border-white/[0.06] ${collapsed ? "w-[84px]" : "w-[260px]"}`}
      >
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close navigation" className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-[292px] max-w-[88vw] shadow-2xl">
            <button aria-label="Close navigation" className="absolute right-3 top-4 z-10 rounded-xl bg-white/10 p-2 text-white" onClick={() => setMobileOpen(false)}>
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className={`transition-[padding] duration-300 ${collapsed ? "lg:pl-[84px]" : "lg:pl-[260px]"}`}>
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-black/[0.055] bg-[color:var(--header-bg)] px-4 backdrop-blur-2xl sm:px-6 lg:px-8 dark:border-white/[0.06]">
          <div className="flex min-w-0 items-center gap-3">
            <button className="icon-button lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <button className="icon-button hidden lg:grid" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((value) => !value)}>
              {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            </button>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">NexiMail</p>
              <p className="truncate text-sm font-extrabold tracking-[-0.01em]">{current.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PwaStatus />
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
