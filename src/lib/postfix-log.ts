import { createHash } from "node:crypto";

export function parsePostfixLog(line: string) {
  const queueId = line.match(/postfix\/(?:smtp|cleanup)\[[^\]]+\]:\s+([A-Z0-9]+):/i)?.[1];
  if (!queueId) return null;
  const messageId = line.match(/message-id=<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i)?.[1] || null;
  const outcome = line.match(/status=(sent|deferred|bounced|expired)\b/i)?.[1]?.toLowerCase() || null;
  return messageId || outcome ? { queueId, messageId, outcome } : null;
}

export function completeLogLines(bytes: Buffer, offset: number) {
  const lines: { line: string; end: number; key: string }[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 10) continue;
    const line = bytes.subarray(start, i).toString("utf8").replace(/\r$/, "");
    lines.push({ line, end: offset + i + 1, key: createHash("sha256").update(`${offset + start}:`).update(line).digest("hex") });
    start = i + 1;
  }
  return { lines, nextOffset: offset + start };
}
