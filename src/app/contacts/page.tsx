import { desc, ilike, or, sql } from "drizzle-orm";
import { Search, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContactsActions } from "@/components/contacts-actions";
import { db, databaseConfigured } from "@/db";
import { contacts, suppressions } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { q = "" } = await searchParams;

  let rows: typeof contacts.$inferSelect[] = [];
  let total = 0;
  let active = 0;
  let suppressed = 0;
  let dbError = false;

  if (databaseConfigured) {
    try {
      const filter = q.trim() ? or(ilike(contacts.email, `%${q.trim()}%`), ilike(contacts.firstName, `%${q.trim()}%`), ilike(contacts.lastName, `%${q.trim()}%`)) : undefined;
      const [data, totalRows, activeRows, suppressionRows] = await Promise.all([
        db.select().from(contacts).where(filter).orderBy(desc(contacts.createdAt)).limit(100),
        db.select({ value: sql<number>`count(*)::int` }).from(contacts),
        db.select({ value: sql<number>`count(*)::int` }).from(contacts).where(sql`${contacts.status} = 'active'`),
        db.select({ value: sql<number>`count(*)::int` }).from(suppressions),
      ]);
      rows = data;
      total = totalRows[0]?.value ?? 0;
      active = activeRows[0]?.value ?? 0;
      suppressed = suppressionRows[0]?.value ?? 0;
    } catch {
      dbError = true;
    }
  }

  const usable = databaseConfigured && !dbError;

  return (
    <AppShell session={session}>
      <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-zinc-400">Audience</p>
          <h1 className="text-3xl font-black tracking-[-0.035em] text-zinc-950 sm:text-4xl dark:text-white">Contacts</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">One normalized source of truth for every recipient. Duplicate email addresses are blocked before they enter the database.</p>
        </div>
        <ContactsActions databaseConfigured={usable} />
      </div>

      {!usable ? (
        <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200">
          <strong className="font-extrabold">Database not connected in this preview.</strong> The Contacts UI is live, but add/import actions stay disabled until PostgreSQL is configured. This prevents fake contact data.
        </section>
      ) : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Total contacts", value: total, icon: UsersRound, tone: "text-violet-600 bg-violet-50 dark:bg-violet-950/30 dark:text-violet-300" },
          { label: "Active", value: active, icon: UserRoundCheck, tone: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300" },
          { label: "Suppressed", value: suppressed, icon: ShieldCheck, tone: "text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300" },
        ].map((item) => {
          const Icon = item.icon;
          return <article key={item.label} className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_10px_35px_rgba(24,24,27,.05)] dark:border-zinc-800 dark:bg-zinc-950"><div className="flex items-center justify-between"><div><p className="text-sm font-bold text-zinc-500 dark:text-zinc-400">{item.label}</p><p className="mt-2 text-3xl font-black tracking-[-.04em] text-zinc-950 dark:text-white">{item.value.toLocaleString()}</p></div><div className={`rounded-xl p-2.5 ${item.tone}`}><Icon className="h-5 w-5" /></div></div></article>;
        })}
      </section>

      <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-[0_14px_45px_rgba(24,24,27,.05)] dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <form className="relative w-full sm:max-w-md" method="get">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input defaultValue={q} name="q" placeholder="Search name or email…" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900" />
          </form>
          <p className="text-xs font-semibold text-zinc-400">Showing up to 100 contacts</p>
        </div>

        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-zinc-50 text-[11px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70"><tr><th className="px-5 py-3.5">Contact</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Validation</th><th className="px-5 py-3.5">Source</th><th className="px-5 py-3.5">Added</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {rows.map((contact) => (
                  <tr key={contact.id} className="transition hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40">
                    <td className="px-5 py-4"><div className="font-bold text-zinc-900 dark:text-zinc-100">{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed contact"}</div><div className="mt-1 text-xs text-zinc-500">{contact.email}</div></td>
                    <td className="px-5 py-4"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold capitalize text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{contact.status}</span></td>
                    <td className="px-5 py-4"><span className="text-xs font-bold capitalize text-zinc-500">{contact.validationStatus}</span></td>
                    <td className="px-5 py-4 text-xs font-semibold text-zinc-500">{contact.source.replaceAll("_", " ")}</td>
                    <td className="px-5 py-4 text-xs text-zinc-400">{new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(contact.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"><UsersRound className="h-5 w-5" /></div><h2 className="mt-4 text-base font-extrabold text-zinc-900 dark:text-zinc-100">{q ? "No matching contacts" : "No contacts yet"}</h2><p className="mt-1 max-w-sm text-sm leading-6 text-zinc-500">{usable ? "Add a contact manually or import a CSV. NexiMail will normalize and deduplicate by email." : "Connect PostgreSQL to start storing contacts."}</p></div></div>
        )}
      </section>
    </AppShell>
  );
}
