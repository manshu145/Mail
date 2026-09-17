export type BounceKind = "recipient" | "policy" | "temporary" | "other";

export type BounceClassification = {
  kind: BounceKind;
  suppressRecipient: boolean;
  providerPressure: boolean;
  reason: string;
};

export function classifyBounce(status?: string | null, diagnostic?: string | null): BounceClassification {
  const dsn = String(status || "").trim();
  const text = String(diagnostic || "").toLowerCase();

  // Suppression must be conservative. Generic phrases such as "recipient address
  // rejected" are also used for policy/authentication blocks and are not proof
  // that the mailbox does not exist.
  const recipientNotFound =
    dsn === "5.1.1" ||
    /user unknown|unknown user|no such user|no such mailbox|mailbox (?:does not exist|not found)|recipient (?:does not exist|not found)|unknown recipient|account (?:does not exist|not found)|invalid mailbox/i.test(text);

  if (recipientNotFound) {
    return { kind: "recipient", suppressRecipient: true, providerPressure: false, reason: "recipient_not_found" };
  }

  const policyReject =
    dsn.startsWith("5.7.") ||
    /spam|policy|reputation|blocked|blacklist|high probability|unsolicited|authentication required|spf|dkim|dmarc|access denied|not authorized|relay access denied/i.test(text);

  if (policyReject) {
    return { kind: "policy", suppressRecipient: false, providerPressure: false, reason: "message_policy_or_reputation_reject" };
  }

  const recipientTemporary = /mailbox full|over quota|quota exceeded|recipient temporarily unavailable/i.test(text);
  if (recipientTemporary) {
    return { kind: "temporary", suppressRecipient: false, providerPressure: false, reason: "recipient_temporary_condition" };
  }

  const providerTemporary =
    dsn.startsWith("4.7.") ||
    /rate limit|too many messages|too many connections|throttl|greylist|unusual traffic|temporarily deferred|try again later|421\b|450\b|451\b|452\b/i.test(text);

  if (providerTemporary) {
    return { kind: "temporary", suppressRecipient: false, providerPressure: true, reason: "temporary_provider_pressure" };
  }

  if (dsn.startsWith("4.")) {
    return { kind: "temporary", suppressRecipient: false, providerPressure: false, reason: "temporary_delivery_failure" };
  }

  return { kind: "other", suppressRecipient: false, providerPressure: false, reason: "other_delivery_failure" };
}
