import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Finding = { file: string; detail: string };

const findings: Finding[] = [];
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const isTextCandidate = (file: string) =>
  !/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file) &&
  !/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf)$/i.test(file);

const allowedEmailDomain = (domain: string) => {
  const d = domain.toLowerCase();
  return d === "example.com" || d.endsWith(".example.com") ||
    d === "example.invalid" || d.endsWith(".example.invalid") ||
    d === "example.local" || d.endsWith(".example.local");
};

const isAllowedIpv4 = (ip: string) => {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  if (p[0] === 10 || p[0] === 127) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  // RFC 5737 documentation ranges.
  if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true;
  if (p[0] === 198 && p[1] === 51 && p[2] === 100) return true;
  if (p[0] === 203 && p[1] === 0 && p[2] === 113) return true;
  return false;
};

for (const file of tracked) {
  if (!isTextCandidate(file)) continue;

  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  // Never ship a real environment file.
  if (/^\.env(?:\..+)?$/.test(file) && file !== ".env.example" && file !== ".env.staging.example") {
    findings.push({ file, detail: "tracked runtime environment file" });
  }

  // Literal personal/customer email addresses do not belong in the release payload.
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)) {
    const domain = match[1];
    if (!allowedEmailDomain(domain)) {
      findings.push({ file, detail: `non-placeholder email literal: ${match[0]}` });
    }
  }

  // Public IPv4 addresses are instance-specific. Use env/config or RFC 5737 examples instead.
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    if (!isAllowedIpv4(match[0])) {
      findings.push({ file, detail: `public IPv4 literal: ${match[0]}` });
    }
  }

  // Fresh-install source must be supplied by the distributor/operator, not tied to one account.
  if (/REPO_URL\s*=\s*["']?https?:\/\/github\.com\//i.test(text)) {
    findings.push({ file, detail: "hard-coded GitHub repository URL in REPO_URL" });
  }

  // Release migrations must create schema only, not tenant/customer data.
  if (file.startsWith("drizzle/")) {
    const seeded = text.match(/insert\s+into\s+"?(users|seed_inboxes|sending_accounts|sending_domains|contacts|campaigns|templates|lists|suppressions)"?/i);
    if (seeded) findings.push({ file, detail: `instance data seeded in migration table: ${seeded[1]}` });
  }
}

const envExample = readFileSync(".env.example", "utf8");
const requiredSafeEnv: Array<[RegExp, string]> = [
  [/^NEXIMAIL_RUNTIME_MODE=staging$/m, "NEXIMAIL_RUNTIME_MODE must default to staging"],
  [/^NEXIMAIL_SEND_ENABLED=false$/m, "NEXIMAIL_SEND_ENABLED must default to false"],
  [/^APP_URL=https:\/\/mail\.example\.com$/m, "APP_URL must use example.com"],
  [/^OWNER_NAME="NexiMail Owner"$/m, "OWNER_NAME must stay generic"],
  [/^OWNER_EMAIL=owner@example\.com$/m, "OWNER_EMAIL must use example.com"],
  [/^MTA_HOSTNAME=mail\.example\.com$/m, "MTA_HOSTNAME must use example.com"],
  [/^MTA_PUBLIC_IP=replace-with-your-public-ipv4$/m, "MTA_PUBLIC_IP must be a placeholder"],
  [/^BOUNCE_DOMAIN=bounce\.example\.com$/m, "BOUNCE_DOMAIN must use example.com"],
];

for (const [pattern, detail] of requiredSafeEnv) {
  if (!pattern.test(envExample)) findings.push({ file: ".env.example", detail });
}

const installScript = readFileSync("deploy/install-isolated.sh", "utf8");
if (/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/.test(installScript)) {
  findings.push({ file: "deploy/install-isolated.sh", detail: "fresh installer contains a hard-coded GitHub repository identity" });
}

if (findings.length) {
  console.error("\nRelease sanitization FAILED:\n");
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.detail}`);
  console.error("\nMove instance-specific values to runtime configuration or database state before release.\n");
  process.exit(1);
}

console.log("Release sanitization passed: no tracked runtime env, personal email literals, public instance IPs, hard-coded installer repo identity, or seeded customer data found.");
