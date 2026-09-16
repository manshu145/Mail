type AuthEnvironment = Readonly<Record<string, string | undefined>>;

const STABLE_PREVIEW_HOST = "neximail-preview.vercel.app";
const STABLE_PREVIEW_SESSION_KEY = "neximail-preview.vercel.app:isolated-demo-session:v1";

function isDedicatedStablePreview(env: AuthEnvironment): boolean {
  return (
    !env.DATABASE_URL &&
    env.VERCEL === "1" &&
    env.VERCEL_ENV === "production" &&
    env.VERCEL_PROJECT_PRODUCTION_URL === STABLE_PREVIEW_HOST
  );
}

// The dedicated Vercel project is an isolated demo surface with no database.
// Other environments still require explicit NEXIMAIL_DEMO_MODE opt-in.
export function isDemoAuthEnabled(env: AuthEnvironment = process.env): boolean {
  if (env.DATABASE_URL) return false;
  if (isDedicatedStablePreview(env)) return true;
  if (env.NEXIMAIL_DEMO_MODE !== "true") return false;

  if (env.VERCEL === "1") return env.VERCEL_ENV === "preview";
  return env.NODE_ENV === "development";
}

export function getAuthSecret(env: AuthEnvironment = process.env): Uint8Array {
  const secret = env.AUTH_SECRET;
  if (secret && secret.length >= 32) return new TextEncoder().encode(secret);

  // The isolated stable preview contains no real customer/database data and has public demo
  // credentials, so it may use a deterministic session key when Vercel secrets are unavailable.
  // Real deployments and normal preview branches must still provide AUTH_SECRET.
  if (isDedicatedStablePreview(env)) {
    return new TextEncoder().encode(STABLE_PREVIEW_SESSION_KEY);
  }

  throw new Error("AUTH_SECRET must be at least 32 characters");
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
