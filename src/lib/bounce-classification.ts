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

  const recipientNotFound =
    dsn === "5.1.1" ||
    /user unknown|unknown user|no such user|no such mailbox|mailbox (?:does not exist|not found)|recipient address rejected|invalid recipient|address rejected|recipient not found|account does not exist/i.test(text);

  if (recipientNotFound) {
    return { kind: "recipient", suppressRecipient: true, providerPressure: false, reason: "recipient_not_found" };
  }

  const policyReject =
    dsn.startsWith("5.7.") ||
    /spam|policy|reputation|blocked|blacklist|high probability|unsolicited|authentication required|spf|dkim|dmarc/i.test(text);

  if (policyReject) {
    return { kind: "policy", suppressRecipient: false, providerPressure: true, reason: "provider_policy_or_reputation" };
  }

  const temporary =
    dsn.startsWith("4.") ||
    /temporar|try again|rate limit|too many|throttl|greylist|mailbox full|over quota/i.test(text);

  if (temporary) {
    return { kind: "temporary", suppressRecipient: false, providerPressure: true, reason: "temporary_provider_or_mailbox_condition" };
  }

  return { kind: "other", suppressRecipient: false, providerPressure: false, reason: "other_delivery_failure" };
}
