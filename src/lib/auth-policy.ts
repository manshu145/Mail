type AuthEnvironment = Readonly<Record<string, string | undefined>>;

const STABLE_PREVIEW_HOST = "neximail-preview.vercel.app";

// Demo access is opt-in and is never available alongside a real database.
// Vercel preview deployments are allowed, plus the dedicated stable NexiMail preview project URL.
export function isDemoAuthEnabled(env: AuthEnvironment = process.env): boolean {
  if (env.NEXIMAIL_DEMO_MODE !== "true" || env.DATABASE_URL) return false;

  if (env.VERCEL === "1") {
    if (env.VERCEL_ENV === "preview") return true;
    return env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL === STABLE_PREVIEW_HOST;
  }

  return env.NODE_ENV === "development";
}

export function getAuthSecret(env: AuthEnvironment = process.env): Uint8Array {
  const secret = env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export function getLoginErrorMessage(error: string): string {
  switch (error) {
    case "rate":
      return "Too many sign-in attempts. Please try again in 10 minutes.";
    case "config":
      return "Sign-in is temporarily unavailable. Please contact your administrator.";
    default:
      return "Invalid credentials or this account is disabled.";
  }
}
