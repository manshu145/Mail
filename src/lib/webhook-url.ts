import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

function isPrivateIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd");
}

export function parseWebhookUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("Enter a valid webhook URL."); }
  if (url.protocol !== "https:") throw new Error("Webhook endpoints must use HTTPS.");
  if (url.username || url.password) throw new Error("Webhook URLs cannot contain credentials.");
  if (url.port && url.port !== "443") throw new Error("Webhook endpoints must use the standard HTTPS port.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local webhook hosts are not allowed.");
  const family = isIP(host);
  if ((family === 4 && isPrivateIpv4(host)) || (family === 6 && isPrivateIpv6(host))) throw new Error("Private-network webhook hosts are not allowed.");
  url.hash = "";
  return url;
}

export async function assertWebhookDestinationPublic(input: string) {
  const url = parseWebhookUrl(input);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("Webhook hostname could not be resolved.");
  for (const { address, family } of addresses) {
    if ((family === 4 && isPrivateIpv4(address)) || (family === 6 && isPrivateIpv6(address))) {
      throw new Error("Webhook hostname resolves to a private network.");
    }
  }
  return url;
}
