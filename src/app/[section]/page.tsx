import { notFound } from "next/navigation";
import { ModulePage } from "@/components/module-page";

const modules: Record<string, { eyebrow: string; title: string; description: string }> = {
  contacts: { eyebrow: "Audience", title: "Contacts", description: "Import, normalize, search, tag and manage every recipient from one source of truth." },
  lists: { eyebrow: "Audience", title: "Lists & segments", description: "Build static lists and dynamic segments without duplicating contact records." },
  validation: { eyebrow: "Deliverability", title: "Validation", description: "Run Gmail-focused single and bulk validation jobs and persist every result." },
  campaigns: { eyebrow: "Messaging", title: "Campaigns", description: "Create, test, schedule and monitor campaigns through the worker-based sending pipeline." },
  templates: { eyebrow: "Messaging", title: "Templates", description: "Create reusable HTML and plain-text email templates with personalization variables." },
  reports: { eyebrow: "Analytics", title: "Reports", description: "Review delivery, bounce, open, click, unsubscribe and recipient-level campaign activity." },
  infrastructure: { eyebrow: "Sending", title: "Infrastructure", description: "Manage sending accounts, domains, limits, queues, reputation and transport configuration." },
  suppressions: { eyebrow: "Compliance", title: "Suppressions", description: "Maintain global unsubscribe, bounce, invalid-address, complaint and policy suppression state." },
  "system-health": { eyebrow: "Operations", title: "System health", description: "Inspect application, database, Redis, workers and Postfix readiness from one operational view." },
  settings: { eyebrow: "Workspace", title: "Settings", description: "Configure workspace defaults, tracking, limits, security and infrastructure-level preferences." },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const module = modules[section];
  if (!module) notFound();
  return <ModulePage {...module} />;
}
