export function BrandMark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-gradient-to-br from-[#7c5cff] via-[#635bff] to-[#4b7cff] text-white shadow-[0_10px_28px_rgba(84,72,220,.32)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,.28),transparent_34%)]" />
        <svg viewBox="0 0 24 24" className="relative h-5 w-5" aria-hidden="true">
          <path d="M4 7.4A2.4 2.4 0 0 1 6.4 5h11.2A2.4 2.4 0 0 1 20 7.4v9.2a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 16.6V7.4Z" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path d="m5.6 7 6.4 5 6.4-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
          <path d="M8.3 15.7h7.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" opacity=".72" />
        </svg>
      </div>
      {!compact && (
        <div className="min-w-0">
          <div className={`text-[16px] font-black tracking-[-0.035em] ${inverse ? "text-white" : "text-zinc-950 dark:text-white"}`}>NexiMail</div>
          <div className={`text-[10px] font-bold uppercase tracking-[0.13em] ${inverse ? "text-white/38" : "text-zinc-400"}`}>Mail infrastructure</div>
        </div>
      )}
    </div>
  );
}
