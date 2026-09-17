export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

export type ImportRow = {
  email: string;
  firstName?: string;
  lastName?: string;
  consentStatus?: "confirmed" | "unconfirmed";
  consentSource?: string;
  source?: string;
  tags?: string[];
  categories?: string[];
  attributes?: Record<string, string | number | boolean | null>;
};
