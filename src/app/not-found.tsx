import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] p-5">
      <section className="w-full max-w-xl rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-7 text-center shadow-[var(--shadow-soft)] sm:p-10">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/10 text-[var(--accent)]"><SearchX className="h-7 w-7" /></div>
        <p className="page-eyebrow mt-6">404 · Not found</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">That workspace page doesn't exist.</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">The link may be outdated, incomplete or unavailable for your current workspace role.</p>
        <a href="/dashboard" className="btn-primary mt-7"><ArrowLeft className="h-4 w-4" /> Back to dashboard</a>
      </section>
    </main>
  );
}
