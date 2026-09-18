export type ValidationVerdict = { status: "accepted" | "valid" | "invalid" | "unknown" | "error"; detail: string };

export function classifyGmailRcptResponse(code: number, line: string): ValidationVerdict {
  if (code === 550 && /5\.1\.1|user unknown|no such user|does not exist/i.test(line)) {
    return { status: "invalid", detail: "gmail_rcpt_550_5.1.1" };
  }
  if (code === 250 || code === 251) {
    return { status: "accepted", detail: `gmail_rcpt_${code}_accepted` };
  }
  if (code >= 400 && code < 500) {
    return { status: "unknown", detail: `gmail_rcpt_${code}_temporary_or_policy` };
  }
  return { status: "unknown", detail: `gmail_rcpt_${code || "ambiguous"}` };
}


export function isDirectGmailAddress(email: string) {
  const domain = String(email || "").trim().toLowerCase().split("@")[1] || "";
  return domain === "gmail.com" || domain === "googlemail.com";
}

export function validationAllowsSend(email: string, status: string) {
  if (status === "invalid") return false;
  if (isDirectGmailAddress(email) && status === "pending") return false;
  return true;
}
