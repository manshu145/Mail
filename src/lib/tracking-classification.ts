import crypto from "node:crypto";

const BOT_PATTERNS = [
  /googleweblight/i,
  /microsoft office/i,
  /outlook-ios/i,
  /barracuda/i,
  /proofpoint/i,
  /mimecast/i,
  /safelinks/i,
  /urlscan/i,
  /security/i,
  /scanner/i,
  /spider/i,
  /crawler/i,
  /bot\b/i,
  /headless/i,
  /phantom/i,
  /facebookexternalhit/i,
  /slackbot/i,
  /discordbot/i,
];

export type TrackingClassification = {
  automated: boolean;
  automationReason: string | null;
  userAgent: string | null;
  ipHash: string | null;
  proxyProvider: "google_image_proxy" | null;
};

function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

export function classifyTrackingRequest(request: Request): TrackingClassification {
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
  const purpose = `${request.headers.get("purpose") || ""} ${request.headers.get("sec-purpose") || ""}`.trim();
  let automationReason: string | null = null;
  if (/prefetch|preview/i.test(purpose)) automationReason = `purpose:${purpose}`;
  if (!automationReason && userAgent) {
    const match = BOT_PATTERNS.find((pattern) => pattern.test(userAgent));
    if (match) automationReason = `user-agent:${match.source}`;
  }
  const proxyProvider = userAgent && /googleimageproxy/i.test(userAgent) ? "google_image_proxy" as const : null;
  const ip = requestIp(request);
  const salt = process.env.TRACKING_HASH_SALT || process.env.AUTH_SECRET || "neximail";
  const ipHash = ip ? crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32) : null;
  return { automated: Boolean(automationReason), automationReason, userAgent, ipHash, proxyProvider };
}
