export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-950/20">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.8"/>
          <path d="m5.5 7 6.5 5 6.5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"/>
        </svg>
      </div>
      {!compact && (
        <div>
          <div className="text-[15px] font-extrabold tracking-[-0.02em] text-slate-950 dark:text-white">NexiMail</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Campaign infrastructure</div>
        </div>
      )}
    </div>
  );
}
