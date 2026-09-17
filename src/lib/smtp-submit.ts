import net from "node:net";

// Once DATA has been written, a lost reply cannot distinguish rejection from acceptance.
export class SmtpSubmissionUncertainError extends Error {
  constructor(message: string) { super(message); this.name = "SmtpSubmissionUncertainError"; }
}
function dotStuff(raw: string) { return raw.replace(/\r?\n/g, "\r\n").split("\r\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n"); }

export async function submitToMta(raw: string, envelopeFrom: string, recipient: string, options: { host: string; port: number; timeoutMs: number }) {
  return new Promise<{ queueId: string | null }>((resolve, reject) => {
    const socket = net.createConnection({ host: options.host, port: options.port });
    socket.setTimeout(options.timeoutMs);
    let buffer = "";
    let stage: "banner" | "ehlo" | "mail" | "rcpt" | "data" | "body" | "done" = "banner";
    let settled = false;
    const finish = (error?: Error, queueId: string | null = null) => { if (settled) return; settled = true; socket.end(); socket.destroy(); if (error) reject(stage === "body" ? new SmtpSubmissionUncertainError(error.message) : error); else resolve({ queueId }); };
    const command = (value: string) => socket.write(`${value}\r\n`);
    const failCode = (code: number, line: string) => { stage = "done"; finish(new Error(`MTA SMTP ${code}: ${line.slice(0, 800)}`)); };
    socket.on("timeout", () => finish(new Error("MTA SMTP timeout")));
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(new Error("MTA SMTP connection closed before confirmation")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^(\d{3})([ -])(.*)$/);
        if (!match || match[2] === "-") continue;
        const code = Number(match[1]);
        if (stage === "banner") { if (code !== 220) return failCode(code, line); stage = "ehlo"; command("EHLO neximail-app"); continue; }
        if (stage === "ehlo") { if (code < 200 || code >= 300) return failCode(code, line); stage = "mail"; command(`MAIL FROM:<${envelopeFrom}>`); continue; }
        if (stage === "mail") { if (code < 200 || code >= 300) return failCode(code, line); stage = "rcpt"; command(`RCPT TO:<${recipient}>`); continue; }
        if (stage === "rcpt") { if (code < 200 || code >= 300) return failCode(code, line); stage = "data"; command("DATA"); continue; }
        if (stage === "data") { if (code !== 354) return failCode(code, line); stage = "body"; socket.write(`${dotStuff(raw)}\r\n.\r\n`); continue; }
        if (stage === "body") { if (code < 200 || code >= 300) return failCode(code, line); const queueId = line.match(/queued as\s+([A-Z0-9]+)/i)?.[1] || line.match(/queue id[=:]?\s*([A-Z0-9]+)/i)?.[1] || null; stage = "done"; return finish(undefined, queueId); }
      }
    });
  });
}

