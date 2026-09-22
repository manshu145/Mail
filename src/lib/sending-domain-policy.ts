export type SendingDomainHealth = {
  status: string;
  spfOk: boolean;
  dkimOk: boolean;
  dmarcOk: boolean;
  bounceDomain: string | null;
  bounceSpfOk: boolean;
  bounceMxOk: boolean;
  bounceStatus: string;
};

export function sendingDomainBlockReason(
  domain: SendingDomainHealth | null | undefined,
  options: { bounceSigningEnabled: boolean },
): string | null {
  if (!domain) return "sender_domain_not_configured";
  if (domain.status !== "ready") return "sender_domain_not_ready";
  if (!domain.spfOk) return "spf_not_ready";
  if (!domain.dkimOk) return "dkim_not_ready";
  if (!domain.dmarcOk) return "dmarc_not_ready";
  if (!options.bounceSigningEnabled) return "bounce_signing_secret_missing";
  if (!domain.bounceDomain?.trim()) return "bounce_domain_not_configured";
  if (domain.bounceStatus !== "ready" || !domain.bounceSpfOk || !domain.bounceMxOk) {
    return "bounce_domain_not_ready";
  }
  return null;
}
