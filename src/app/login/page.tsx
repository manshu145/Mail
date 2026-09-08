import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const params = await searchParams;

  return (
    <main className="shell">
      <section className="hero auth-card">
        <span className="badge">NexiMail Admin</span>
        <h1>Sign in</h1>
        <p>Use your NexiMail owner, admin, or operator account.</p>
        {params.error ? <p className="error">Invalid credentials or disabled account.</p> : null}
        <form method="post" action="/api/auth/login" className="form-grid">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className="button button-reset" type="submit">Sign in</button>
        </form>
      </section>
    </main>
  );
}
