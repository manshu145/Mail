export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="badge">NexiMail · Phase 1</span>
        <h1>Your contacts. Your infrastructure. Your sending rules. Your data.</h1>
        <p>
          The NexiMail foundation is running. PostgreSQL stores permanent application data,
          Redis provides queue and temporary state, and campaign delivery will be handled by
          background workers rather than web requests.
        </p>
        <a className="button" href="/api/health">Check system health</a>
      </section>
    </main>
  );
}
