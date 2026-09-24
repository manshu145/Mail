import type { ValidationVerdict } from "./validation-policy";

export function recipientDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

export function recipientProvider(domainInput: string) {
  const domain = domainInput.trim().toLowerCase();
  if (domain === "gmail.com" || domain === "googlemail.com") return "google";
  if (["yahoo.com","yahoo.co.in","yahoo.in","yahoo.co.uk","ymail.com","rocketmail.com"].includes(domain)) return "yahoo";
  if (["outlook.com","hotmail.com","hotmail.co.in","live.com","live.in","msn.com"].includes(domain)) return "microsoft";
  if (domain === "rediffmail.com" || domain === "rediff.com") return "rediff";
  if (["icloud.com","me.com","mac.com"].includes(domain)) return "apple";
  return domain || "__unknown__";
}

export function validationIsPreRecipientFailure(verdict: ValidationVerdict) {
  const detail = String(verdict.detail || "").toLowerCase();
  return verdict.status === "unknown" &&
    /^(smtp_banner_|smtp_helo_|smtp_mail_from_|smtp_validation_timeout|smtp_validation_connection_failed|provider_hold_active)/.test(detail);
}

export function validationNeedsBackoff(verdict: ValidationVerdict) {
  const detail = String(verdict.detail || "").toLowerCase();
  return verdict.status === "unknown" &&
    /temporary_or_policy|policy_or_ambiguous|timeout|connection_failed|banner_|helo_|mail_from_|provider_hold_active|supersend_http_429|supersend_http_5\d\d|supersend_request_failed/.test(detail);
}

export async function runProviderAwarePool<T>(
  items: readonly T[],
  providerOf: (item: T) => string,
  task: (item: T) => Promise<ValidationVerdict>,
  options: {
    concurrency: number;
    lanesForProvider: (provider: string) => number;
    providerStartGapMs: number | ((provider: string) => number);
    globalStartGapMs?: number;
    backoffDelayMs: number;
    shouldStop?: () => Promise<boolean>;
    shouldHoldProvider?: (verdict: ValidationVerdict) => boolean;
    providerHoldUntil?: (provider: string) => number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
) {
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const byProvider = new Map<string, T[]>();

  for (const item of items) {
    const provider = providerOf(item) || "__unknown__";
    const bucket = byProvider.get(provider);
    if (bucket) bucket.push(item);
    else byProvider.set(provider, [item]);
  }

  const lanes: Array<{ provider: string; items: T[] }> = [];
  for (const [provider, bucket] of byProvider) {
    const laneCount = Math.max(1, Math.min(bucket.length, Math.floor(options.lanesForProvider(provider) || 1)));
    const providerLanes = Array.from({ length: laneCount }, () => [] as T[]);
    bucket.forEach((item, index) => providerLanes[index % laneCount].push(item));
    for (const laneItems of providerLanes) if (laneItems.length) lanes.push({ provider, items: laneItems });
  }

  const providerNextStart = new Map<string, number>();
  let globalNextStart = 0;
  const heldProviders = new Set<string>();
  let cursor = 0;
  let completed = 0;
  let stopped = false;
  const workerCount = Math.max(1, Math.min(Math.floor(options.concurrency || 1), lanes.length || 1));

  async function reserveProviderStart(provider: string) {
    const current = now();
    const providerScheduled = Math.max(current, providerNextStart.get(provider) || 0);
    const globalScheduled = Math.max(current, globalNextStart || 0);
    const scheduled = Math.max(providerScheduled, globalScheduled);
    const configuredGap = typeof options.providerStartGapMs === "function"
      ? options.providerStartGapMs(provider)
      : options.providerStartGapMs;
    providerNextStart.set(provider, scheduled + Math.max(0, configuredGap));
    globalNextStart = scheduled + Math.max(0, options.globalStartGapMs || 0);
    const wait = scheduled - current;
    if (wait > 0) await sleep(wait);
  }

  const worker = async () => {
    while (!stopped) {
      const index = cursor++;
      if (index >= lanes.length) return;
      const lane = lanes[index];

      for (const item of lane.items) {
        if (options.shouldStop && await options.shouldStop()) {
          stopped = true;
          return;
        }

        while (true) {
          if (options.shouldStop && await options.shouldStop()) {
            stopped = true;
            return;
          }
          const holdUntil = options.providerHoldUntil?.(lane.provider) || 0;
          const waitMs = holdUntil - now();
          if (waitMs <= 0) break;
          await sleep(Math.min(waitMs, 1000));
        }

        await reserveProviderStart(lane.provider);
        const verdict = await task(item);
        completed++;

        if (options.shouldHoldProvider?.(verdict)) {
          heldProviders.add(lane.provider);
          continue;
        }

        if (validationNeedsBackoff(verdict)) {
          const until = now() + Math.max(0, options.backoffDelayMs);
          providerNextStart.set(lane.provider, Math.max(providerNextStart.get(lane.provider) || 0, until));
        }
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return {
    completed,
    stopped,
    providers: byProvider.size,
    lanes: lanes.length,
    concurrency: workerCount,
    heldProviders: [...heldProviders],
  };
}
