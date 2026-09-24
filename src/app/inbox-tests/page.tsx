import { desc, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { InboxTestsClient } from "@/components/inbox-tests-client";
import { db, databaseConfigured } from "@/db";
import { campaigns } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { inboxTestResults, inboxTests, seedInboxes } from "@/db/operations-schema";

export default async function InboxTestsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!databaseConfigured) {
    return <AppShell session={session}><div className="page-intro"><p className="page-eyebrow">Deliverability</p><h1 className="page-title">Inbox placement</h1><p className="page-description">Database unavailable.</p></div></AppShell>;
  }

  const [seeds, availableCampaigns, tests] = await Promise.all([
    db.select().from(seedInboxes).orderBy(desc(seedInboxes.createdAt)),
    db.select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, templateId: campaigns.templateId, sendingAccountId: campaigns.sendingAccountId }).from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100),
    db.select().from(inboxTests).orderBy(desc(inboxTests.createdAt)).limit(50),
  ]);
  const results = tests.length ? await db.select().from(inboxTestResults).where(inArray(inboxTestResults.testId, tests.map((test) => test.id))) : [];

  return <AppShell session={session}>
    <div className="page-intro">
      <div><p className="page-eyebrow">Deliverability</p><h1 className="page-title">Inbox placement</h1><p className="page-description">Run controlled seed tests across Gmail, Outlook and other inboxes you control, then record the actual folder where each message landed.</p></div>
    </div>
    <InboxTestsClient seeds={seeds} campaigns={availableCampaigns} tests={tests} results={results} />
  </AppShell>;
}
