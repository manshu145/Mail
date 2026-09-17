export type MailboxProvider = "gmail" | "yahoo" | "microsoft" | "proton" | "rediff" | "mailcom" | "zoho" | "mailhostbox" | "titan" | "netcore" | "godaddy" | "mailcore" | `domain:${string}`;

export function providerForEmail(email: string): MailboxProvider {
  const domain = String(email || "").trim().toLowerCase().split("@").pop() || "unknown";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (domain === "yahoo.com" || domain.startsWith("yahoo.") || domain === "ymail.com" || domain === "rocketmail.com" || domain === "aol.com") return "yahoo";
  if (domain === "outlook.com" || domain === "hotmail.com" || domain.startsWith("hotmail.") || domain === "live.com" || domain.startsWith("live.") || domain === "msn.com") return "microsoft";
  if (domain === "proton.me" || domain === "protonmail.com" || domain === "pm.me") return "proton";
  if (domain === "rediffmail.com" || domain === "rediff.com") return "rediff";
  if (domain === "mail.com") return "mailcom";
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
 * Provider cooldown is only for temporary provider-level pressure/restrictions.
 * Permanent 5.x policy/spam rejections are message-level failures and must not
 * pause the entire provider from a single rejection.
 */
export function isProviderPressureResponse(response: string, dsn?: string | null) {
  const text = String(response || "").toLowerCase();
  if (dsn?.startsWith("5.")) return false;
  if (dsn?.startsWith("4.")) return true;

  // Only explicit temporary SMTP/provider signals qualify when DSN is absent.
  if (/\b(?:421|450|451|452)\b|\b4\.\d+\.\d+\b/i.test(text)) return true;
  return /temporar(?:y|ily)?|try again|rate limit|too many|throttl|greylist|resources? temporarily unavailable|unusual traffic.*try again/i.test(text);
}
