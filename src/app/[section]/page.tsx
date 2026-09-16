import { notFound } from "next/navigation";
import { ModulePage } from "@/components/module-page";

const modules: Record<string, { eyebrow: string; title: string; description: string }> = {
  contacts: { eyebrow: "Audience", title: "Contacts", description: "Import, normalize, search, tag and manage every recipient from one source of truth." },
  lists: { eyebrow: "Audience", title: "Lists", description: "Organize contacts into reusable static audiences without duplicating recipient records." },
  segments: { eyebrow: "Audience", title: "Segments", description: "Build rule-based dynamic audiences from contact attributes, tags and engagement state." },
  imports: { eyebrow: "Audience", title: "Imports", description: "Track staged contact imports, validation state, processing progress and import history." },
  validation: { eyebrow: "Deliverability", title: "Email validation", description: "Run Gmail-focused single and bulk validation workflows and persist every result." },
  "gmail-validation": { eyebrow: "Deliverability", title: "Gmail validation", description: "Inspect the dedicated Gmail validation queue, worker results and blocked invalid addresses." },
  campaigns: { eyebrow: "Messaging", title: "Campaigns", description: "Create, test, schedule and monitor campaigns through the worker-based sending pipeline." },
  templates: { eyebrow: "Messaging", title: "Templates", description: "Create reusable HTML and plain-text email templates with personalization variables." },
  messages: { eyebrow: "Messaging", title: "Message log", description: "Inspect recipient-level message state across queued, sending, delivered, deferred and bounced events." },
  queue: { eyebrow: "Messaging", title: "Delivery queue", description: "Monitor queued, active and deferred mail as it moves through NexiMail workers and transport." },
  domains: { eyebrow: "Deliverability", title: "Sending domains", description: "Manage domain approval, DNS readiness, authentication state and sending eligibility." },
  "sender-identities": { eyebrow: "Deliverability", title: "Sender identities", description: "Manage approved From names, addresses and domain-backed sending identities." },
  "inbox-placement": { eyebrow: "Deliverability", title: "Inbox placement", description: "Review inbox-placement test results and delivery signals without fabricating provider outcomes." },
  suppressions: { eyebrow: "Compliance", title: "Suppressions", description: "Maintain unsubscribe, bounce, invalid-address, complaint and policy suppression state." },
  reports: { eyebrow: "Analytics", title: "Analytics", description: "Review delivery, bounce, open, click, unsubscribe and recipient-level campaign activity." },
  infrastructure: { eyebrow: "Platform", title: "Infrastructure", description: "Manage sending accounts, domains, limits, queues, reputation and transport configuration." },
  "api-keys": { eyebrow: "Developer", title: "API keys", description: "Manage API credentials for transactional and platform integrations with explicit access controls." },
  webhooks: { eyebrow: "Developer", title: "Webhooks", description: "Configure event destinations for delivery, bounce, complaint and campaign lifecycle events." },
  users: { eyebrow: "Workspace", title: "Team access", description: "Manage owner, admin and operator access across the NexiMail control plane." },
  "team-access": { eyebrow: "Workspace", title: "Team access", description: "Review workspace members, invitations and role-based control-plane permissions." },
  "audit-log": { eyebrow: "Workspace", title: "Audit log", description: "Review sensitive administrative actions and operational changes across the workspace." },
  "system-health": { eyebrow: "Operations", title: "System health", description: "Inspect application, database, Redis, workers and Postfix readiness from one operational view." },
  settings: { eyebrow: "Workspace", title: "Settings", description: "Configure workspace defaults, tracking, limits, security and infrastructure-level preferences." },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const module = modules[section];
  if (!module) notFound();
  return <ModulePage {...module} />;
}
