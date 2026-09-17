import type { ImportMapping, ImportOptions } from "@/db/import-schema";
import type { ImportRow } from "@/lib/contact-utils";

export const IMPORT_FIELDS = ["email","name","first_name","last_name","phone","dob","gender","state","district","city","pincode","occupation","industry","audience_type","category","categories","tags","source"] as const;

const aliases: Record<string, string[]> = {
  email: ["email","emailaddress","emailid","email_id","e-mail","mail"],
  name: ["name","fullname","full_name"],
  first_name: ["firstname","first_name","first"],
  last_name: ["lastname","last_name","last","surname"],
  phone: ["phone","mobile","mobileno","mobile_no","phone_number"],
  dob: ["dob","dateofbirth","date_of_birth"],
  gender: ["gender","sex"],
  state: ["state"], district: ["district"], city: ["city"], pincode: ["pincode","pin","postalcode","zipcode"],
  occupation: ["occupation","job","profession"], industry: ["industry"], audience_type: ["audiencetype","audience_type"],
  category: ["category"], categories: ["categories"], tags: ["tags","tag"], source: ["source","leadsource","lead_source"],
};

export function normalizeCsvHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((v) => v.length)) rows.push(row); row = []; }
    else cell += char;
  }
  row.push(cell); if (row.some((v) => v.length)) rows.push(row);
  return rows;
}

export function detectMapping(headers: string[]): ImportMapping {
  const normalized = headers.map(normalizeCsvHeader);
  const mapping: ImportMapping = {};
  for (const [field, names] of Object.entries(aliases)) {
    const accepted = names.map(normalizeCsvHeader);
    const index = normalized.findIndex((h) => accepted.includes(h));
    if (index >= 0) mapping[field] = headers[index];
  }
  return mapping;
}

function splitMulti(value?: string) {
  return (value || "").split("|").map((v) => v.trim()).filter(Boolean);
}

export function buildImportRow(headers: string[], values: string[], mapping: ImportMapping, options: ImportOptions): ImportRow {
  const record = new Map(headers.map((h, i) => [h, values[i] ?? ""]));
  const get = (field: string) => mapping[field] ? String(record.get(mapping[field]) || "").trim() : "";
  const fullName = get("name");
  const pieces = fullName.split(/\s+/).filter(Boolean);
  const firstName = get("first_name") || (pieces.length ? pieces[0] : "");
  const lastName = get("last_name") || (pieces.length > 1 ? pieces.slice(1).join(" ") : "");
  const mappedHeaders = new Set(Object.values(mapping));
  const attributes: Record<string, string> = {};
  headers.forEach((header, i) => {
    if (!mappedHeaders.has(header)) {
      const value = String(values[i] || "").trim();
      if (value) attributes[header] = value;
    }
  });
  for (const field of ["phone","dob","gender","state","district","city","pincode","occupation","industry","audience_type"] as const) {
    const value = get(field); if (value) attributes[field] = value;
  }
  const categories = [...splitMulti(options.defaultCategory), ...splitMulti(get("category")), ...splitMulti(get("categories"))];
  const tags = [...(options.defaultTags || []), ...splitMulti(get("tags"))];
  return {
    email: get("email"), firstName, lastName,
    consentStatus: options.consentStatus,
    consentSource: options.consentSource,
    source: get("source") || options.defaultSource || "csv_import",
    tags: [...new Set(tags)], categories: [...new Set(categories)],
    attributes,
  };
}
