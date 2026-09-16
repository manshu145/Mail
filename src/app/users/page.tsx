import { ShieldCheck, UserCog, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { UserRowActions } from "@/components/user-row-actions";
import { db, databaseConfigured } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/dashboard");

  let rows: typeof users.$inferSelect[] = [];
  let dbError = false;
  if (databaseConfigured) {
    try { rows = await db.select().from(users).orderBy(desc(users.createdAt)); } catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;
  const admins = rows.filter((row) => row.role === "admin" && row.status === "active").length;
  const operators = rows.filter((row) => row.role === "operator" && row.status === "active").length;

  return (
    <AppShell session={session}>
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="page-eyebrow mb-2">Workspace security</p><h1 className="page-title">Team access</h1><p className="page-description">Control owner, admin and operator access. Roles are revalidated against persistent user state on every protected session.</p></div>
        <ResourceCreate disabled={!usable} endpoint="/api/users" title="Create user" buttonLabel="Add team member" fields={[{name:"name",label:"Name",required:true},{name:"email",label:"Email",type:"email",required:true},{name:"password",label:"Temporary password (12+ chars)",type:"password",required:true},{name:"role",label:"Role",type:"select",options:["admin","operator"],required:true}]} />
      </div>

      {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>User database unavailable.</b> Team mutations are disabled until PostgreSQL is connected.</div> : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        {[{label:"Workspace users",value:rows.length,icon:UsersRound},{label:"Active admins",value:admins,icon:ShieldCheck},{label:"Active operators",value:operators,icon:UserCog}].map(({label,value,icon:Icon}) => <article key={label} className="metric-card p-5"><div className="flex items-start justify-between"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value.toLocaleString()}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}
      </section>

      <section className="premium-panel overflow-hidden">
        {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.13em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">User</th><th>Role</th><th>Status</th><th>Created</th><th>Controls</th></tr></thead><tbody>{rows.map((user) => <tr key={user.id} className="border-t border-[var(--border)]"><td className="px-5 py-4"><div className="font-black">{user.name}</div><div className="mt-1 text-xs text-[var(--muted)]">{user.email}</div></td><td><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-bold capitalize text-violet-700 dark:text-violet-300">{user.role}</span></td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${user.status === "active" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"}`}>{user.status}</span></td><td className="text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle:"medium"}).format(user.createdAt)}</td><td><UserRowActions id={user.id} role={user.role} status={user.status} /></td></tr>)}</tbody></table></div> : <div className="grid min-h-64 place-items-center text-center"><div><UsersRound className="mx-auto h-8 w-8 text-[var(--muted)]" /><h2 className="mt-4 font-black">No database users available</h2></div></div>}
      </section>
    </AppShell>
  );
}
