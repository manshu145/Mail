import { LockKeyhole, Mail } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getSession } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const params = await searchParams;

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-8 dark:bg-[#070b14] sm:grid sm:place-items-center">
      <div className="mx-auto w-full max-w-[430px]">
        <div className="mb-7 flex justify-center"><BrandMark /></div>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_80px_rgba(15,23,42,.08)] sm:p-8 dark:border-slate-800 dark:bg-slate-950">
          <div className="mb-7">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Secure workspace</p>
            <h1 className="text-3xl font-black tracking-[-0.035em] text-slate-950 dark:text-white">Sign in to NexiMail</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Use your owner, admin or operator account to continue.</p>
          </div>
          {params.error ? <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-950 dark:bg-red-950/40 dark:text-red-300">Invalid credentials or this account is disabled.</div> : null}
          <form method="post" action="/api/auth/login" className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">Email address</span>
              <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-900">
                <Mail className="h-4 w-4 text-slate-400" />
                <input name="email" type="email" autoComplete="email" required placeholder="owner@example.com" className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-slate-400" />
              </div>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-200">Password</span>
              <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-900">
                <LockKeyhole className="h-4 w-4 text-slate-400" />
                <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••••••" className="w-full bg-transparent px-3 py-3 text-sm outline-none placeholder:text-slate-400" />
              </div>
            </label>
            <button type="submit" className="mt-2 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20">Sign in</button>
          </form>
        </section>
        <p className="mt-5 text-center text-xs text-slate-400">Self-hosted control plane · Your data stays under your infrastructure.</p>
      </div>
    </main>
  );
}
