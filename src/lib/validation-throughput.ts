import type { ValidationVerdict } from "./validation-policy";

export function recipientDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

export function validationDelayForVerdict(
  verdict: ValidationVerdict,
  minDelayMs: number,
  backoffDelayMs: number,
) {
  const detail = String(verdict.detail || "").toLowerCase();
  if (
    verdict.status === "unknown" &&
    /temporary_or_policy|policy_or_ambiguous|timeout|connection_failed|banner_|helo_|mail_from_/.test(detail)
  ) {
    return Math.max(minDelayMs, backoffDelayMs);
  }
  return Math.max(0, minDelayMs);
}

export async function runDomainAwarePool<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  task: (item: T) => Promise<ValidationVerdict>,
  options: {
    concurrency: number;
    minDelayMs: number;
    backoffDelayMs: number;
    shouldStop?: () => Promise<boolean>;
    sleep?: (ms: number) => Promise<void>;
  },
) {
  const lanes = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item) || "__unknown__";
    const lane = lanes.get(key);
    if (lane) lane.push(item);
    else lanes.set(key, [item]);
  }

  const queue = [...lanes.entries()];
  let cursor = 0;
  let completed = 0;
  let stopped = false;
  const sleep = options.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const workerCount = Math.max(1, Math.min(Math.floor(options.concurrency || 1), queue.length || 1));

  const worker = async () => {
    while (!stopped) {
      const index = cursor++;
      if (index >= queue.length) return;
      const [, lane] = queue[index];

      // One worker owns a domain lane for the full batch, so the same recipient
      // domain is never probed concurrently. Different domains can progress in
      // parallel up to the global concurrency cap.
      for (const item of lane) {
        if (options.shouldStop && await options.shouldStop()) {
          stopped = true;
          return;
        }
        const verdict = await task(item);
        completed++;
        const delay = validationDelayForVerdict(verdict, options.minDelayMs, options.backoffDelayMs);
        if (delay > 0) await sleep(delay);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { completed, stopped, domains: lanes.size, concurrency: workerCount };
}
