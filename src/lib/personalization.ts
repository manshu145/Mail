type ContactLike = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  attributes?: unknown;
};

function attributesOf(contact: ContactLike) {
  return contact.attributes && typeof contact.attributes === "object" && !Array.isArray(contact.attributes)
    ? contact.attributes as Record<string, unknown>
    : {};
}

function valueForToken(contact: ContactLike, token: string) {
  const key = token.trim().toLowerCase();
  const attrs = attributesOf(contact);
  const firstName = String(contact.firstName || "").trim();
  const lastName = String(contact.lastName || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  if (key === "first_name" || key === "firstname") return firstName;
  if (key === "last_name" || key === "lastname") return lastName;
  if (key === "name" || key === "full_name" || key === "fullname") return fullName;
  if (key === "email") return String(contact.email || "").trim();

  const exact = Object.entries(attrs).find(([name]) => name.toLowerCase() === key)?.[1];
  if (exact === null || exact === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof exact)) return String(exact);
  return "";
}

function personalize(value: string, contact: ContactLike, escape: (value: string) => string) {
  return String(value || "").replace(/{{\s*([a-zA-Z0-9_ -]+?)(?:\|([^{}]*))?\s*}}/g, (_match, rawToken: string, rawFallback?: string) => {
    const token = rawToken.trim();
    if (token.toLowerCase() === "unsubscribe_url") return _match;
    const resolved = valueForToken(contact, token);
    return escape(resolved || String(rawFallback || "").trim());
  });
}

export function samplePersonalization(value: string, recipient: string) {
  const local = recipient.split("@")[0] || "";
  const first = local.split(/[._-]/)[0] || "Test";
  const firstName = first.charAt(0).toUpperCase() + first.slice(1);
  return personalizeContactText(value, {
    email: recipient,
    firstName,
    lastName: "Recipient",
    attributes: {
      city: "Raipur",
      state: "Chhattisgarh",
      district: "Raipur",
      pincode: "492001",
      category: "Customer",
      occupation: "Customer",
      industry: "General",
    },
  });
}

export function personalizeContactText(value: string, contact: ContactLike) {
  return personalize(value, contact, (text) => text);
}
export function personalizeContactHtml(value: string, contact: ContactLike) {
  return personalize(value, contact, (text) => text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!));
}
