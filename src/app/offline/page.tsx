import { WifiOff } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 dark:bg-[#070b14]">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-6 flex justify-center"><BrandMark /></div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-300"><WifiOff className="h-6 w-6" /></div>
        <h1 className="mt-5 text-2xl font-black tracking-tight text-slate-950 dark:text-white">You’re offline</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">NexiMail does not cache private dashboard or campaign data. Reconnect to continue securely.</p>
        <a href="/dashboard" className="mt-6 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white">Try again</a>
      </section>
    </main>
  );
}
