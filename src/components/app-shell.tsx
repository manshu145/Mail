"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Blocks, ChevronDown, ContactRound, FileUp, Gauge,
  Globe2, Layers3, ListOrdered, Mail, MailCheck, Menu, Network,
  PanelLeftClose, PanelLeftOpen, Send, Settings, ShieldBan, TimerReset, Users, X,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { PwaStatus } from "./pwa-status";
import { ThemeToggle } from "./theme-toggle";

type SessionView = { name: string; email: string; role: "owner" | "admin" | "operator" };
type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; roles?: SessionView["role"][] };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { label: "Overview", items: [
    { href: "/dashboard", label: "Dashboard", icon: Gauge },
  ]},
  { label: "Audience", items: [
    { href: "/contacts", label: "Contacts", icon: ContactRound },
    { href: "/lists", label: "Lists & segments", icon: Layers3 },
    { href: "/segments", label: "Engagement segments", icon: Blocks },
    { href: "/imports", label: "Imports", icon: FileUp },
    { href: "/validation", label: "Validation", icon: MailCheck },
  ]},
  { label: "Campaigns", items: [
    { href: "/campaigns", label: "Campaigns", icon: Send },
    { href: "/templates", label: "Templates", icon: Mail },
  ]},
  { label: "Delivery", items: [
    { href: "/reports", label: "Reports", icon: BarChart3 },
    { href: "/messages", label: "Message log", icon: ListOrdered },
  ]},
  { label: "Deliverability", items: [
    { href: "/domains", label: "Sending domains", icon: Globe2 },
    { href: "/sender-identities", label: "Sender identities", icon: Network },
    { href: "/suppressions", label: "Suppressions", icon: ShieldBan },
    { href: "/provider-cooldowns", label: "Provider cooldowns", icon: TimerReset },
  ]},
  { label: "Workspace", items: [
    { href: "/users", label: "Team access", icon: Users, roles: ["owner"] },
    { href: "/settings", label: "Settings", icon: Settings },
  ]},
]

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NM";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function AppShell({ session, children }: { session: SessionView; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({ Overview:true, Audience:true, Campaigns:true, Delivery:true, Deliverability:false, Platform:false }));

  const visibleGroups = useMemo(() => navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(session.role)),
  })).filter((group) => group.items.length > 0), [session.role]);

  const current = useMemo(() => {
    for (const group of visibleGroups) for (const item of group.items) if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item;
    return visibleGroups[0]?.items[0] || navGroups[0].items[0];
  }, [pathname, visibleGroups]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("neximail.sidebar.groups");
      if (stored) setOpenGroups((current) => ({ ...current, ...JSON.parse(stored) }));
      setCollapsed(window.localStorage.getItem("neximail.sidebar.collapsed") === "1");
    } catch {}
  }, []);

  useEffect(() => {
    const activeGroup = visibleGroups.find((group) => group.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)));
    if (activeGroup) setOpenGroups((current) => current[activeGroup.label] ? current : { ...current, [activeGroup.label]: true });
  }, [pathname, visibleGroups]);

  function toggleGroup(label: string) {
    setOpenGroups((current) => {
      const next = { ...current, [label]: !current[label] };
      try { window.localStorage.setItem("neximail.sidebar.groups", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const sidebar = (compact: boolean) => (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--sidebar)] text-[var(--sidebar-fg)]">
      <div className={`flex h-[68px] items-center border-b border-[var(--sidebar-border)] ${compact ? "justify-center px-3" : "px-5"}`}><BrandMark compact={compact} /></div>
      <div className="flex-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        {visibleGroups.map((group) => {
          const groupOpen = compact || openGroups[group.label] !== false;
          return <div key={group.label} className="mb-2.5 last:mb-1">
            {!compact ? <button type="button" onClick={() => toggleGroup(group.label)} className="mb-1.5 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--sidebar-muted)] transition hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-fg)]">
              <span>{group.label}</span><ChevronDown className={`h-3 w-3 transition-transform ${groupOpen?"rotate-0":"-rotate-90"}`}/>
            </button> : null}
            {groupOpen ? <nav className="space-y-0.5">{group.items.map((item) => { const Icon=item.icon; const active=pathname===item.href||pathname.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} title={compact?item.label:undefined} onClick={()=>setMobileOpen(false)} className={`group flex h-[40px] items-center rounded-[12px] border transition-all duration-150 ${compact?"justify-center px-2":"gap-3 px-3"} ${active?"border-violet-500/20 bg-violet-600 text-white shadow-[0_8px_20px_rgba(109,93,252,.22)]":"border-transparent text-[var(--sidebar-muted)] hover:border-violet-500/10 hover:bg-[linear-gradient(90deg,var(--sidebar-hover),rgba(109,93,252,.055))] hover:text-[var(--sidebar-fg)] hover:shadow-[inset_3px_0_0_rgba(109,93,252,.22)]"}`}><Icon className="h-4 w-4 shrink-0" strokeWidth={active?2.15:1.8}/>{!compact&&<span className="truncate text-[13px] font-bold">{item.label}</span>}</Link>})}</nav> : null}
          </div>;
        })}
      </div>
      <div className="border-t border-[var(--sidebar-border)] bg-[linear-gradient(180deg,transparent,rgba(109,93,252,.025))] p-3">
        <div className={`flex items-center ${compact?"justify-center":"gap-2.5"}`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-[#7c5cff] to-[#4b7cff] text-[10px] font-black text-white">{initials(session.name)}</div>{!compact&&<><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-extrabold">{session.name}</div><div className="truncate text-[11px] capitalize text-[var(--sidebar-muted)]">{session.role}</div></div><ChevronDown className="h-3.5 w-3.5 text-[var(--sidebar-muted)]"/></>}</div>
        {!compact&&<form action="/api/auth/logout" method="post" className="mt-2.5"><button className="w-full rounded-[10px] border border-[var(--sidebar-border)] bg-[var(--sidebar-hover)] px-3 py-2.5 text-[12px] font-bold text-[var(--sidebar-muted)] transition hover:text-[var(--sidebar-fg)]">Sign out</button></form>}
      </div>
    </div>
  );

  return <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
    <aside className={`fixed inset-y-0 left-0 z-30 hidden border-r border-[var(--sidebar-border)] transition-[width] duration-200 lg:block ${collapsed?"w-[76px]":"w-[248px]"}`}>{sidebar(collapsed)}</aside>
    {mobileOpen&&<div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close navigation" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={()=>setMobileOpen(false)}/><aside className="relative h-full w-[286px] max-w-[88vw] shadow-2xl"><button aria-label="Close navigation" className="absolute right-3 top-4 z-10 rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-hover)] p-2 text-[var(--sidebar-fg)]" onClick={()=>setMobileOpen(false)}><X className="h-4.5 w-4.5"/></button>{sidebar(false)}</aside></div>}
    <div className={`transition-[padding] duration-200 ${collapsed?"lg:pl-[76px]":"lg:pl-[248px]"}`}>
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[var(--border)] bg-[color:var(--header-bg)] px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><button className="icon-button grid lg:hidden" aria-label="Open navigation" onClick={()=>setMobileOpen(true)}><Menu className="h-[18px] w-[18px]"/></button><button className="icon-button hidden lg:grid" aria-label={collapsed?"Expand sidebar":"Collapse sidebar"} onClick={()=>setCollapsed(v=>{const next=!v;try{window.localStorage.setItem("neximail.sidebar.collapsed",next?"1":"0")}catch{}return next})}>{collapsed?<PanelLeftOpen className="h-[17px] w-[17px]"/>:<PanelLeftClose className="h-[17px] w-[17px]"/>}</button><div className="min-w-0"><p className="truncate text-[10px] font-black uppercase tracking-[0.15em] text-[var(--muted)]">Workspace</p><p className="truncate text-[14px] font-extrabold tracking-[-0.01em]">{current.label}</p></div></div>
        <div className="flex items-center gap-2"><PwaStatus/><ThemeToggle/></div>
      </header>
      <main className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  </div>;
}
