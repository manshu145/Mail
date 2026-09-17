import net from "node:net";

export type MtaSubmitOptions = {
  host?: string;
  port?: number;
  timeoutMs?: number;
};

function dotStuff(raw: string) {
  return raw.replace(/\r?\n/g, "\r\n").split("\r\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
}

export async function submitToMta(raw: string, envelopeFrom: string, recipient: string, options: MtaSubmitOptions = {}) {
  const host = options.host || process.env.MTA_HOST || "mta";
  const port = Math.max(1, options.port || Number(process.env.MTA_PORT || "10025"));
  const timeoutMs = Math.max(3000, options.timeoutMs || Number(process.env.MTA_SMTP_TIMEOUT_MS || "15000"));

  return new Promise<{ queueId: string | null }>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    let buffer = "";
    let stage: "banner" | "ehlo" | "mail" | "rcpt" | "data" | "body" | "done" = "banner";
    let settled = false;

    const finish = (error?: Error, queueId: string | null = null) => {
      if (settled) return;
      settled = true;
      socket.end();
      socket.destroy();
      if (error) reject(error); else resolve({ queueId });
    };
    const command = (value: string) => socket.write(`${value}\r\n`);
    const failCode = (code: number, line: string) => finish(new Error(`MTA SMTP ${code}: ${line.slice(0, 800)}`));

    socket.on("timeout", () => finish(new Error("MTA SMTP timeout")));
    socket.on("error", (error) => finish(error));
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
        if (stage === "body") {
          if (code < 200 || code >= 300) return failCode(code, line);
          const queueId = line.match(/queued as\s+([A-Z0-9]+)/i)?.[1] || line.match(/queue id[=:]?\s*([A-Z0-9]+)/i)?.[1] || null;
          stage = "done"; command("QUIT"); return finish(undefined, queueId);
        }
      }
    });
  });
}
