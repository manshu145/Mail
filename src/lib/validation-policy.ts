export type ValidationVerdict = { status: "valid" | "invalid" | "unknown" | "error"; detail: string };

export function classifyGmailRcptResponse(code: number, line: string): ValidationVerdict {
  if (code === 550 && /5\.1\.1|user unknown|no such user|does not exist/i.test(line)) {
    return { status: "invalid", detail: "gmail_rcpt_550_5.1.1" };
  }
  if (code === 250 || code === 251) {
    return { status: "unknown", detail: `gmail_rcpt_${code}_accepted_not_proof` };
  }
  return { status: "unknown", detail: `gmail_rcpt_${code || "ambiguous"}` };
}
