/** Marketing eligibility requires an explicit opt-in with a recorded source. */
export function hasConfirmedConsent(contact: { consentStatus: string; consentSource: string | null }): boolean {
  return contact.consentStatus === "confirmed" && Boolean(contact.consentSource?.trim());
}
