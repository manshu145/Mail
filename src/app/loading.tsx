export default function Loading() {
  return (
    <div className="min-h-dvh bg-[var(--background)] p-4 sm:p-6 lg:p-8" aria-busy="true" aria-label="Loading">
      <div className="ui-loading-bar" />
      <div className="mx-auto max-w-[1480px] space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-3">
            <div className="ui-skeleton h-2.5 w-24" />
            <div className="ui-skeleton h-9 w-52" />
            <div className="ui-skeleton h-4 w-[min(620px,72vw)]" />
          </div>
          <div className="hidden gap-2 sm:flex">
            <div className="ui-skeleton h-10 w-28" />
            <div className="ui-skeleton h-10 w-32" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1,2,3,4].map((item) => <div key={item} className="premium-panel p-5"><div className="ui-skeleton h-3 w-24" /><div className="ui-skeleton mt-4 h-9 w-28" /><div className="ui-skeleton mt-6 h-3 w-full" /></div>)}
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          {[1,2].map((item) => <div key={item} className="section-card p-5"><div className="ui-skeleton h-4 w-36" /><div className="ui-skeleton mt-2 h-3 w-64" /><div className="space-y-3 pt-6">{[1,2,3,4,5].map((row) => <div key={row} className="ui-skeleton h-10 w-full" />)}</div></div>)}
        </div>
      </div>
    </div>
  );
}
