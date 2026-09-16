type RuntimeEnv = Readonly<Record<string, string | undefined>>;

export type RuntimePolicy = {
  mode: "staging" | "production";
  isolated: boolean;
  sendingEnabled: boolean;
  maxRecipientsPerCampaign: number | null;
};

const DEFAULT_STAGING_MAX_RECIPIENTS = 5000;
const ABSOLUTE_STAGING_MAX_RECIPIENTS = 5000;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRuntimePolicy(env: RuntimeEnv = process.env): RuntimePolicy {
  const mode = env.NEXIMAIL_RUNTIME_MODE === "production" ? "production" : "staging";

  if (mode === "production") {
    return {
      mode,
      isolated: false,
      sendingEnabled: true,
      maxRecipientsPerCampaign: null,
    };
  }

  const requestedLimit = parsePositiveInteger(
    env.NEXIMAIL_STAGING_MAX_RECIPIENTS,
    DEFAULT_STAGING_MAX_RECIPIENTS,
  );

  return {
    mode,
    isolated: true,
    sendingEnabled: env.NEXIMAIL_STAGING_SEND_ENABLED === "true",
    maxRecipientsPerCampaign: Math.min(requestedLimit, ABSOLUTE_STAGING_MAX_RECIPIENTS),
  };
}
