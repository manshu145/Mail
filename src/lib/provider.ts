export type MailboxProvider = "gmail" | "yahoo" | "microsoft" | "proton" | "rediff" | "mailcom" | "zoho" | "mailhostbox" | "titan" | "netcore" | "godaddy" | "mailcore" | `domain:${string}`;

export type DeliveryRestrictionScope = "none" | "provider" | "sender";
export type DeliveryRestriction = {
  scope: DeliveryRestrictionScope;
  reason:
    | "none"
    | "recipient_or_mailbox_condition"
    | "provider_restriction"
    | "sender_or_outbound_path_restriction";
};

export const SENDER_COOLDOWN_KEY = "__sender__";

export function providerForEmail(email: string): MailboxProvider {
  const domain = String(email || "").trim().toLowerCase().split("@").pop() || "unknown";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (domain === "yahoo.com" || domain.startsWith("yahoo.") || domain === "ymail.com" || domain === "rocketmail.com" || domain === "aol.com") return "yahoo";
  if (domain === "outlook.com" || domain === "hotmail.com" || domain.startsWith("hotmail.") || domain === "live.com" || domain.startsWith("live.") || domain === "msn.com") return "microsoft";
  if (domain === "proton.me" || domain === "protonmail.com" || domain === "pm.me") return "proton";
  if (domain === "rediffmail.com" || domain === "rediff.com") return "rediff";
  if (domain === "mail.com") return "mailcom";
  if (domain === "zoho.com" || domain === "zohomail.com" || domain === "zoho.in" || domain === "zohomail.in") return "zoho";
  return `domain:${domain}`;
}

export function providerFromResponse(response: string): MailboxProvider | null {
  const value = String(response || "").toLowerCase();
  if (!value) return null;
  if (value.includes("google.com") || value.includes("googlemail.com") || value.includes("aspmx.l.google.com") || value.includes("gmail")) return "gmail";
  if (value.includes("yahoodns.net") || value.includes("yahoo.com") || value.includes("aol.com")) return "yahoo";
  if (value.includes("mail.protection.outlook.com") || value.includes("protection.outlook") || value.includes("hotmail") || value.includes("outlook.com")) return "microsoft";
  if (value.includes("protonmail") || value.includes("proton.me")) return "proton";
  if (value.includes("rediffmail")) return "rediff";
  if (value.includes("zoho.com") || value.includes("zohomail")) return "zoho";
  if (value.includes("mailhostbox.com")) return "mailhostbox";
  if (value.includes("titan.email")) return "titan";
  if (value.includes("netcore")) return "netcore";
  if (value.includes("secureserver.net")) return "godaddy";
  if (value.includes("mailcore.net")) return "mailcore";
  return null;
}

export function providerForDelivery(email: string, response?: string | null): MailboxProvider {
  return providerFromResponse(response || "") || providerForEmail(email);
}

export function providerLabel(provider: string) {
  if (provider === SENDER_COOLDOWN_KEY) return "Sender / outbound path";
  if (provider === "gmail") return "Gmail / Google Workspace";
  if (provider === "yahoo") return "Yahoo / AOL";
  if (provider === "microsoft") return "Microsoft 365 / Outlook";
  if (provider === "proton") return "Proton Mail";
  if (provider === "rediff") return "Rediffmail";
  if (provider === "mailcom") return "Mail.com";
  if (provider === "zoho") return "Zoho Mail";
  if (provider === "mailhostbox") return "MailHostBox";
  if (provider === "titan") return "Titan Mail";
  if (provider === "netcore") return "Netcore";
  if (provider === "godaddy") return "GoDaddy Mail";
  if (provider === "mailcore") return "Mailcore";
  if (provider.startsWith("domain:")) return provider.slice(7);
  return provider;
}

/**
 * Decide whether an SMTP response represents a recipient-level temporary
 * condition, a mailbox-provider restriction, or a sender/outbound-path
 * restriction. Enhanced status class alone is intentionally insufficient:
 * 4.x responses are also used for mailbox-full, recipient policy, DNS and
 * resource conditions and must not pause an entire provider.
 */
export function classifyDeliveryRestriction(response: string, dsn?: string | null): DeliveryRestriction {
  const text = String(response || "").toLowerCase();

  const recipientOrMailbox =
    /mailbox full|over quota|quota exceeded|recipient temporarily unavailable|mailbox temporarily unavailable|mailbox delivery restricted by policy|user unknown|unknown user|no such (?:user|mailbox)|mailbox (?:does not exist|not found)|recipient (?:does not exist|not found)/i.test(text);
  if (recipientOrMailbox) {
    return { scope: "none", reason: "recipient_or_mailbox_condition" };
  }

  // JFE050004 is emitted by the upstream outbound Mail Bridge before the
  // destination SMTP conversation. It therefore applies to the sending path,
  // not to one recipient provider. Stop the sender immediately instead of
  // continuing to feed thousands of messages into the restricted bridge.
  const outboundBridgeRestriction =
    /jfe050004|unusual number of invalid recipients originating from your account/i.test(text);
  if (outboundBridgeRestriction) {
    return { scope: "sender", reason: "sender_or_outbound_path_restriction" };
  }

  // Provider-local policy systems sometimes use sender/account wording even
  // though the restriction applies only at that receiving network. Keep
  // these responses provider-scoped; they must never freeze unrelated
  // recipients or the entire sending account.
  const providerReportedSenderRestriction =
    /jfe050005|unusual amount of content policy violations originating from your account/i.test(text);
  if (providerReportedSenderRestriction) {
    return { scope: "provider", reason: "sender_or_outbound_path_restriction" };
  }

  // Reserve immediate sender-wide cooldowns for responses that explicitly
  // identify the local sending account/outbound SMTP path as suspended.
  const explicitSenderOrOutboundPath =
    /sending account (?:is )?(?:restricted|blocked|suspended)|outbound (?:mail|smtp).*(?:account|sender).*(?:restricted|blocked|suspended)/i.test(text);
  if (explicitSenderOrOutboundPath) {
    return { scope: "sender", reason: "sender_or_outbound_path_restriction" };
  }

  const explicitProviderRestriction =
    /rate[ -]?limit|too many (?:messages|connections|requests)|throttl|unusual traffic|temporar(?:y|ily) blocked|temporary block|not yet authorized to deliver mail from|sender(?: ip)? reputation|ip reputation|greylist(?:ed|ing)?(?:.*(?:sender|ip))?|try again later(?:.*(?:rate|sender|ip|reputation))?/i.test(text);
  if (explicitProviderRestriction) {
    return { scope: "provider", reason: "provider_restriction" };
  }

  // A bare SMTP 4xx/4.x enhanced status is deliberately not enough evidence
  // for a provider-wide cooldown.
  void dsn;
  return { scope: "none", reason: "none" };
}

/** Backward-compatible helper for provider-scoped pressure only. */
export function isProviderPressureResponse(response: string, dsn?: string | null) {
  return classifyDeliveryRestriction(response, dsn).scope === "provider";
}
