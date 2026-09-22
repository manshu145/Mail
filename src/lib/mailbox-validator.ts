import net from "node:net";
import os from "node:os";
import { resolveMx } from "node:dns/promises";
import { isValidEmail, normalizeEmail } from "@/lib/contact-utils";
import type { ValidationVerdict } from "@/lib/validation-policy";

type SmtpReply = { code: number; line: string };

function explicitMailboxMissing(code: number, line: string) {
  return code >= 500 && code < 600 &&
    /5\.1\.1|5\.1\.0|user unknown|unknown user|no such user|mailbox (?:not found|unavailable)|recipient (?:address )?rejected.*(?:not found|does not exist|unknown)|does not exist|invalid recipient|recipient not found/i.test(line);
}

export function classifyMailboxRcptResponse(code: number, line: string): ValidationVerdict {
  if (code === 250 || code === 251) return { status: "accepted", detail: `smtp_rcpt_${code}_accepted` };
  if (explicitMailboxMissing(code, line)) return { status: "invalid", detail: `smtp_rcpt_${code}_mailbox_missing` };
  if (code >= 400 && code < 500) return { status: "unknown", detail: `smtp_rcpt_${code}_temporary_or_policy` };
  if (code >= 500 && code < 600) return { status: "unknown", detail: `smtp_rcpt_${code}_policy_or_ambiguous` };
  return { status: "unknown", detail: `smtp_rcpt_${code || "ambiguous"}` };
}

function readReply(socket: net.Socket, timeoutMs: number): Promise<SmtpReply> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const finish = (error: Error | null, reply?: SmtpReply) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(reply || { code: 0, line: "" });
    };
    const onError = (error: Error) => finish(error);
    const onTimeout = () => finish(new Error("SMTP validation timeout"));
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      const match = last.match(/^(\d{3})([ -])(.*)$/);
      if (match && match[2] === " ") {
        finish(null, { code: Number(match[1]), line: lines.join(" ").slice(0, 1000) });
      }
    };
    socket.setTimeout(timeoutMs);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
  });
}

async function command(socket: net.Socket, line: string, timeoutMs: number) {
  socket.write(line + "\r\n");
  return readReply(socket, timeoutMs);
}

async function probeMx(host: string, email: string, timeoutMs: number): Promise<ValidationVerdict> {
  const socket = net.createConnection({ host, port: 25 });
  try {
    const banner = await readReply(socket, timeoutMs);
    if (banner.code !== 220) return { status: "unknown", detail: `smtp_banner_${banner.code || "invalid"}` };

    const ehloName = String(process.env.MAIL_HOSTNAME || process.env.MTA_HOSTNAME || os.hostname() || "localhost").trim();
    let hello = await command(socket, `EHLO ${ehloName}`, timeoutMs);
    if (hello.code >= 500) hello = await command(socket, `HELO ${ehloName}`, timeoutMs);
    if (hello.code < 200 || hello.code >= 400) return { status: "unknown", detail: `smtp_helo_${hello.code || "failed"}` };

    const mail = await command(socket, "MAIL FROM:<>", timeoutMs);
    if (mail.code < 200 || mail.code >= 400) return { status: "unknown", detail: `smtp_mail_from_${mail.code || "failed"}` };

    const rcpt = await command(socket, `RCPT TO:<${email}>`, timeoutMs);
    return classifyMailboxRcptResponse(rcpt.code, rcpt.line);
  } catch (error) {
    return {
      status: "unknown",
      detail: error instanceof Error && /timeout/i.test(error.message)
        ? "smtp_validation_timeout"
        : "smtp_validation_connection_failed",
    };
  } finally {
    try { socket.write("QUIT\r\n"); } catch {}
    socket.destroy();
  }
}

export async function validateMailboxInternally(emailInput: string, timeoutMs = 8_000): Promise<ValidationVerdict> {
  const email = normalizeEmail(emailInput);
  if (!isValidEmail(email)) return { status: "invalid", detail: "invalid_email_syntax" };

  const domain = email.split("@")[1] || "";
  let records: Array<{ exchange: string; priority: number }>;
  try {
    records = await resolveMx(domain);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
    if (code === "ENODATA" || code === "ENOTFOUND") return { status: "invalid", detail: "recipient_domain_no_mx" };
    return { status: "unknown", detail: `recipient_domain_dns_error:${code || "lookup_failed"}` };
  }

  const hosts = records
    .filter((record) => record.exchange && record.exchange !== ".")
    .sort((a, b) => a.priority - b.priority)
    .map((record) => record.exchange.replace(/\.$/, ""));

  if (!hosts.length) return { status: "invalid", detail: "recipient_domain_null_or_no_mx" };

  let last: ValidationVerdict = { status: "unknown", detail: "smtp_validation_no_usable_mx" };
  for (const host of hosts.slice(0, 3)) {
    const result = await probeMx(host, email, timeoutMs);
    if (result.status === "accepted" || result.status === "invalid") return result;
    last = result;
  }
  return last;
}
