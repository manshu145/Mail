import { ArrowRight, CheckCircle2, LockKeyhole, Mail, ServerCog, ShieldCheck, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getSession } from "@/lib/auth";
import { getLoginErrorMessage } from "@/lib/auth-policy";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const params = await searchParams;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#eef2f8] p-3 dark:bg-[#080a0e] sm:p-5 lg:p-6">
      <div className="pointer-events-none absolute -left-20 -top-24 h-[440px] w-[440px] rounded-full bg-violet-500/[0.12] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-[-4%] h-[480px] w-[480px] rounded-full bg-blue-500/[0.10] blur-3xl" />

      <div className="relative mx-auto grid min-h-[calc(100dvh-24px)] max-w-[1380px] overflow-hidden rounded-[30px] border border-black/[0.06] bg-white shadow-[0_30px_100px_rgba(28,38,58,.13)] dark:border-white/[0.07] dark:bg-[#11141a] dark:shadow-[0_30px_100px_rgba(0,0,0,.4)] sm:min-h-[calc(100dvh-40px)] lg:grid-cols-[1.05fr_.95fr] lg:min-h-[calc(100dvh-48px)]">
        <section className="relative hidden overflow-hidden bg-[#10131a] p-10 text-white lg:flex lg:flex-col xl:p-14">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(124,92,255,.22),transparent_30%),radial-gradient(circle_at_88%_85%,rgba(67,120,255,.14),transparent_28%)]" />
          <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] [background-size:38px_38px]" />

          <div className="relative z-10">
            <BrandMark inverse />
          </div>

          <div className="relative z-10 my-auto max-w-xl py-16">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-white/65">
              <Sparkles className="h-3.5 w-3.5 text-violet-300" /> Self-hosted email infrastructure
            </div>
            <h1 className="text-[clamp(2.8rem,5vw,5.4rem)] font-black leading-[.94] tracking-[-0.065em]">Control every send.<br /><span className="bg-gradient-to-r from-[#a99dff] via-[#7f91ff] to-[#6aa9ff] bg-clip-text text-transparent">Own the stack.</span></h1>
            <p className="mt-7 max-w-lg text-[15px] leading-7 text-white/52">Campaigns, audience, validation, delivery, reputation and infrastructure — unified around your own VPS runtime.</p>

            <div className="mt-9 grid gap-3 sm:grid-cols-2">
              {[
                [ShieldCheck, "Private by design", "Customer and campaign data stays under your infrastructure."],
                [ServerCog, "VPS-native runtime", "Built around workers, Redis, PostgreSQL and Postfix."],
              ].map(([Icon, title, copy]) => {
                const Component = Icon as typeof ShieldCheck;
                return (
                  <div key={String(title)} className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4 backdrop-blur-sm">
                    <Component className="h-5 w-5 text-violet-300" />
                    <p className="mt-3 text-sm font-extrabold">{String(title)}</p>
                    <p className="mt-1 text-xs leading-5 text-white/42">{String(copy)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-2 text-[11px] font-bold text-white/30">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Control plane preview mapped to the production architecture
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-10 lg:px-12 xl:px-20">
          <div className="w-full max-w-[460px]">
            <div className="mb-8 lg:hidden"><BrandMark /></div>

            <div className="mb-8">
              <p className="page-eyebrow mb-3">Secure workspace</p>
              <h2 className="text-[2.2rem] font-black leading-none tracking-[-0.05em] sm:text-[2.6rem]">Welcome back.</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Sign in with an owner, admin or operator account to open the NexiMail control plane.</p>
            </div>

            {params.error ? (
              <div role="alert" className="mb-5 rounded-2xl border border-rose-500/15 bg-rose-500/[0.07] px-4 py-3.5 text-sm font-semibold text-rose-700 dark:text-rose-300">
                {getLoginErrorMessage(params.error)}
              </div>
            ) : null}

            <form method="post" action="/api/auth/login" className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-[12px] font-extrabold">Email address</span>
                <div className="flex h-[52px] items-center rounded-[15px] border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 transition focus-within:border-violet-500/50 focus-within:bg-[var(--surface)] focus-within:ring-4 focus-within:ring-violet-500/[0.07]">
                  <Mail className="h-[17px] w-[17px] text-[var(--muted)]" />
                  <input name="email" type="email" autoComplete="email" required placeholder="owner@example.com" className="h-full w-full bg-transparent px-3 text-sm font-medium outline-none placeholder:font-normal placeholder:text-[var(--muted)]" />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-[12px] font-extrabold">Password</span>
                <div className="flex h-[52px] items-center rounded-[15px] border border-[var(--border-strong)] bg-[var(--surface-soft)] px-3.5 transition focus-within:border-violet-500/50 focus-within:bg-[var(--surface)] focus-within:ring-4 focus-within:ring-violet-500/[0.07]">
                  <LockKeyhole className="h-[17px] w-[17px] text-[var(--muted)]" />
                  <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••••••" className="h-full w-full bg-transparent px-3 text-sm font-medium outline-none placeholder:font-normal placeholder:text-[var(--muted)]" />
                </div>
              </label>

              <button type="submit" className="btn-primary mt-2 h-[50px] w-full !rounded-[15px]">
                Sign in <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--muted)]">Preview access</p>
              <div className="mt-2 grid gap-1 text-xs leading-5">
                <p><span className="font-bold">Email:</span> admin@neximail.local</p>
                <p><span className="font-bold">Password:</span> NexiMail@2026!</p>
              </div>
            </div>

            <p className="mt-6 text-center text-[11px] font-semibold leading-5 text-[var(--muted)]">Self-hosted control plane · Production secrets and customer data remain outside this preview.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
