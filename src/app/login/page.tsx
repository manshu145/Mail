import { LockKeyhole, Mail } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getSession } from "@/lib/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const params = await searchParams;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f6f5f2] px-4 py-8 dark:bg-[#0d0d0e] sm:grid sm:place-items-center">
      <div className="pointer-events-none absolute left-[-10%] top-[-18%] h-[420px] w-[420px] rounded-full bg-violet-500/[0.08] blur-3xl dark:bg-violet-400/[0.06]" />
      <div className="pointer-events-none absolute bottom-[-20%] right-[-10%] h-[380px] w-[380px] rounded-full bg-amber-500/[0.06] blur-3xl dark:bg-amber-400/[0.04]" />
      <div className="relative mx-auto w-full max-w-[430px]">
        <div className="mb-7 flex justify-center"><BrandMark /></div>
        <section className="rounded-[28px] border border-black/[0.07] bg-white/90 p-6 shadow-[0_24px_90px_rgba(24,24,27,.09)] backdrop-blur-xl sm:p-8 dark:border-white/[0.08] dark:bg-[#151516]/95 dark:shadow-[0_24px_90px_rgba(0,0,0,.35)]">
          <div className="mb-7">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">Secure workspace</p>
            <h1 className="text-3xl font-black tracking-[-0.045em] text-zinc-950 dark:text-white">Sign in to NexiMail</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">Use your owner, admin or operator account to continue.</p>
          </div>
          {params.error ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">Invalid credentials or this account is disabled.</div> : null}
          <form method="post" action="/api/auth/login" className="space-y-4">
            <label className="block"><span className="mb-2 block text-sm font-bold text-zinc-700 dark:text-zinc-200">Email address</span><div className="flex items-center rounded-xl border border-black/[0.08] bg-[#faf9f7] px-3 transition focus-within:border-violet-500/50 focus-within:ring-4 focus-within:ring-violet-500/[0.08] dark:border-white/[0.08] dark:bg-white/[0.035]"><Mail className="h-4 w-4 text-zinc-400" /><input name="email" type="email" autoComplete="email" required placeholder="owner@example.com" className="w-full bg-transparent px-3 py-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-white" /></div></label>
            <label className="block"><span className="mb-2 block text-sm font-bold text-zinc-700 dark:text-zinc-200">Password</span><div className="flex items-center rounded-xl border border-black/[0.08] bg-[#faf9f7] px-3 transition focus-within:border-violet-500/50 focus-within:ring-4 focus-within:ring-violet-500/[0.08] dark:border-white/[0.08] dark:bg-white/[0.035]"><LockKeyhole className="h-4 w-4 text-zinc-400" /><input name="password" type="password" autoComplete="current-password" required placeholder="••••••••••••" className="w-full bg-transparent px-3 py-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-white" /></div></label>
            <button type="submit" className="btn-primary mt-2 w-full">Sign in</button>
          </form>
        </section>
        <p className="mt-5 text-center text-xs font-medium text-zinc-400">Self-hosted control plane · Your data stays under your infrastructure.</p>
      </div>
    </main>
  );
}
