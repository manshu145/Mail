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
  Users,
  Webhook,
  X,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { PwaStatus } from "./pwa-status";
import { ThemeToggle } from "./theme-toggle";

type SessionView = { name: string; email: string; role: "owner" | "admin" | "operator" };
type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: Gauge }] },
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
      <div className={`flex h-[70px] items-center border-b border-[var(--sidebar-border)] ${collapsed ? "justify-center px-3" : "px-5"}`}>
        <BrandMark compact={collapsed} />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-1">
            {!collapsed && <div className="mb-1.5 px-2.5 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--sidebar-muted)]">{group.label}</div>}
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
                    className={`group flex h-9 items-center rounded-[11px] border transition-all duration-150 ${collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"} ${active ? "border-violet-500/20 bg-violet-600 text-white shadow-[0_8px_20px_rgba(109,93,252,.22)]" : "border-transparent text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-fg)]"}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.15 : 1.8} />
                    {!collapsed && <span className="truncate text-[12.5px] font-bold">{item.label}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--sidebar-border)] p-3">
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-2.5"}`}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#7c5cff] to-[#4b7cff] text-[10px] font-black text-white">
            {initials(session.name)}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-extrabold">{session.name}</div>
                <div className="truncate text-[10px] capitalize text-[var(--sidebar-muted)]">{session.role}</div>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-[var(--sidebar-muted)]" />
            </>
          )}
        </div>
        {!collapsed && (
          <form action="/api/auth/logout" method="post" className="mt-2.5">
            <button className="w-full rounded-[10px] border border-[var(--sidebar-border)] bg-[var(--sidebar-hover)] px-3 py-2 text-[11px] font-bold text-[var(--sidebar-muted)] transition hover:text-[var(--sidebar-fg)]">Sign out</button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <aside className={`fixed inset-y-0 left-0 z-30 hidden border-r border-[var(--sidebar-border)] transition-[width] duration-200 lg:block ${collapsed ? "w-[76px]" : "w-[244px]"}`}>{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close navigation" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-[286px] max-w-[88vw] shadow-2xl">
            <button aria-label="Close navigation" className="absolute right-3 top-4 z-10 rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-hover)] p-2 text-[var(--sidebar-fg)]" onClick={() => setMobileOpen(false)}><X className="h-4.5 w-4.5" /></button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[76px]" : "lg:pl-[244px]"}`}>
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-[var(--border)] bg-[color:var(--header-bg)] px-4 backdrop-blur-xl sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button className="icon-button lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu className="h-[18px] w-[18px]" /></button>
            <button className="icon-button hidden lg:grid" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((value) => !value)}>
              {collapsed ? <PanelLeftOpen className="h-[17px] w-[17px]" /> : <PanelLeftClose className="h-[17px] w-[17px]" />}
            </button>
            <div className="min-w-0">
              <p className="truncate text-[9px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">Workspace</p>
              <p className="truncate text-[13px] font-extrabold tracking-[-0.01em]">{current.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2"><PwaStatus /><ThemeToggle /></div>
        </header>

        <main className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-6 lg:px-7 lg:py-7">{children}</main>
      </div>
    </div>
  );
}
