import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const cards = [
    ["Contacts", "0"],
    ["Emails sent today", "0"],
    ["Queued", "0"],
    ["Delivered", "0"],
  ];

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">NexiMail</div>
          <p className="muted">Self-hosted email marketing</p>
        </div>
        <nav>
          <a className="nav-active" href="/dashboard">Dashboard</a>
          <span>Contacts</span>
          <span>Campaigns</span>
          <span>Reports</span>
          <span>Infrastructure</span>
          <span>Suppressions</span>
          <span>Settings</span>
          <span>System Health</span>
        </nav>
      </aside>
      <section className="dashboard-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Phase 1 · Foundation</p>
            <h1>Dashboard</h1>
          </div>
          <div className="account">
            <div>
              <strong>{session.name}</strong>
              <span>{session.role}</span>
            </div>
            <form action="/api/auth/logout" method="post">
              <button className="ghost-button" type="submit">Sign out</button>
            </form>
          </div>
        </header>
        <div className="stats-grid">
          {cards.map(([label, value]) => (
            <article className="stat-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
        <section className="panel">
          <div>
            <p className="eyebrow">System state</p>
            <h2>Foundation ready for campaign modules</h2>
          </div>
          <p>PostgreSQL, Redis, authentication and role-aware access form the base for the next NexiMail phases.</p>
          <a className="button" href="/api/health">Open health endpoint</a>
        </section>
      </section>
    </main>
  );
}
