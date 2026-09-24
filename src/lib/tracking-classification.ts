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
  qualified: boolean;
  qualificationReason: string | null;
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
  const automated = Boolean(automationReason);
  return { automated, automationReason, qualified: !automated, qualificationReason: automated ? automationReason : null, userAgent, ipHash, proxyProvider };
}

export function qualifyOpenEvent(
  classification: TrackingClassification,
  context: { deliveredAt: Date | string | null; eventAt?: Date; sameIpDistinctRecipients: number },
): TrackingClassification & { deliveryToOpenMs: number | null; sameIpDistinctRecipients: number } {
  const eventAt = context.eventAt || new Date();
  const deliveredAt = context.deliveredAt ? new Date(context.deliveredAt) : null;
  const deliveryToOpenMs = deliveredAt && !Number.isNaN(deliveredAt.getTime()) ? eventAt.getTime() - deliveredAt.getTime() : null;
  let automated = classification.automated;
  let automationReason = classification.automationReason;
  let qualified = classification.qualified;
  let qualificationReason = classification.qualificationReason;

  if (deliveryToOpenMs === null) {
    automated = true;
    qualified = false;
    automationReason = "delivery_not_confirmed";
    qualificationReason = automationReason;
  } else if (deliveryToOpenMs < 0) {
    automated = true;
    qualified = false;
    automationReason = "impossible_timing:before_delivery";
    qualificationReason = automationReason;
  } else if (!classification.proxyProvider && context.sameIpDistinctRecipients >= 10) {
    automated = true;
    qualified = false;
    automationReason = "shared_ip_recipient_burst";
    qualificationReason = automationReason;
  } else if (!classification.proxyProvider && deliveryToOpenMs !== null && deliveryToOpenMs < 2_000 && context.sameIpDistinctRecipients >= 3) {
    automated = true;
    qualified = false;
    automationReason = "rapid_shared_ip_open";
    qualificationReason = automationReason;
  }

  return { ...classification, automated, automationReason, qualified, qualificationReason, deliveryToOpenMs, sameIpDistinctRecipients: context.sameIpDistinctRecipients };
}

export function qualifyClickEvent(
  classification: TrackingClassification,
  context: { deliveredAt: Date | string | null; eventAt?: Date; sameIpDistinctRecipients: number },
): TrackingClassification & { deliveryToClickMs: number | null; sameIpDistinctRecipients: number } {
  const eventAt = context.eventAt || new Date();
  const deliveredAt = context.deliveredAt ? new Date(context.deliveredAt) : null;
  const deliveryToClickMs = deliveredAt && !Number.isNaN(deliveredAt.getTime()) ? eventAt.getTime() - deliveredAt.getTime() : null;
  let automated = classification.automated;
  let automationReason = classification.automationReason;
  let qualified = classification.qualified;
  let qualificationReason = classification.qualificationReason;

  if (deliveryToClickMs === null) {
    automated = true;
    qualified = false;
    automationReason = "delivery_not_confirmed";
    qualificationReason = automationReason;
  } else if (deliveryToClickMs < 0) {
    automated = true;
    qualified = false;
    automationReason = "impossible_timing:before_delivery";
    qualificationReason = automationReason;
  } else if (!classification.proxyProvider && context.sameIpDistinctRecipients >= 10) {
    automated = true;
    qualified = false;
    automationReason = "shared_ip_recipient_burst";
    qualificationReason = automationReason;
  } else if (!classification.proxyProvider && deliveryToClickMs < 2_000 && context.sameIpDistinctRecipients >= 3) {
    automated = true;
    qualified = false;
    automationReason = "rapid_shared_ip_click";
    qualificationReason = automationReason;
  }

  return { ...classification, automated, automationReason, qualified, qualificationReason, deliveryToClickMs, sameIpDistinctRecipients: context.sameIpDistinctRecipients };
}
