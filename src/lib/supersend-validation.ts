import type { ValidationVerdict } from "./validation-policy";

export const DEFAULT_SUPERSEND_VERIFY_URL = "https://api.supersend.io/v2/email-validation/verify";

function signalSuffix(record: Record<string, unknown>) {
  const parts: string[] = [];
  const score = Number(record.validity_score);
  if (Number.isFinite(score)) parts.push("score=" + score);
  if (record.risk_level) parts.push("risk=" + String(record.risk_level).toLowerCase());
  if (record.confidence) parts.push("confidence=" + String(record.confidence).toLowerCase());
  if (record.has_historical_data === true) parts.push("history=present");
  if (record.total_sends != null) parts.push("sends=" + String(record.total_sends));
  if (record.hard_bounce_count != null) parts.push("hard_bounces=" + String(record.hard_bounce_count));
  return parts.length ? ":" + parts.join(",") : "";
}

/** SuperSend V2 uses data.valid as the authoritative mailbox verdict. */
export function classifySupersendPayload(body: unknown): ValidationVerdict {
  const root = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const data = root && root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : null;

  if (!data) {
    return {
      status: "unknown",
      detail: root?.success === false ? "supersend_v2_failed_response" : "supersend_v2_missing_data",
    };
  }

  const subtype = String(data.subtype || data.validation_subtype || "").trim().toLowerCase();
  const suffix = signalSuffix(data);

  if (data.is_disallowed === true) {
    return {
      status: "invalid",
      detail: "supersend_v2_disallowed" + (subtype ? ":" + subtype : "") + suffix,
    };
  }

  if (typeof data.valid === "boolean") {
    return {
      status: data.valid ? "valid" : "invalid",
      detail: (data.valid ? "supersend_v2_valid" : "supersend_v2_invalid") + (subtype ? ":" + subtype : "") + suffix,
    };
  }

  const verdict = String(data.verdict || "").trim().toLowerCase();
  if (verdict === "valid") return { status: "valid", detail: "supersend_v2_valid" + (subtype ? ":" + subtype : "") + suffix };
  if (verdict === "invalid") return { status: "invalid", detail: "supersend_v2_invalid" + (subtype ? ":" + subtype : "") + suffix };
  if (verdict === "risky") return { status: "unknown", detail: "supersend_v2_risky" + (subtype ? ":" + subtype : "") + suffix };

  return { status: "unknown", detail: "supersend_v2_ambiguous" + suffix };
}

export async function verifyWithSupersend(
  email: string,
  apiKey: string,
  options: { endpoint?: string; timeoutMs?: number } = {},
): Promise<ValidationVerdict> {
  const endpoint = String(options.endpoint || process.env.SUPERSEND_VERIFY_URL || DEFAULT_SUPERSEND_VERIFY_URL).trim();
  const timeoutMs = Math.max(3000, Number(options.timeoutMs || process.env.VALIDATION_API_TIMEOUT_MS || "10000"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
        "Accept": "application/json",
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null) as unknown;

    if (!response.ok) {
      const root = body && typeof body === "object" ? body as Record<string, unknown> : null;
      const error = root?.error && typeof root.error === "object" ? root.error as Record<string, unknown> : null;
      const code = String(error?.code || "").trim();
      const message = String(error?.message || "").trim().slice(0, 160);
      const requestId = String(root?.request_id || response.headers.get("X-Request-Id") || "").trim();
      const detail = [
        "supersend_http_" + response.status,
        code || message || null,
        requestId ? "request=" + requestId : null,
      ].filter(Boolean).join(":");

      return {
        status: response.status === 402 ? "error" : response.status >= 500 || response.status === 429 ? "unknown" : "error",
        detail: detail || "supersend_http_" + response.status,
      };
    }

    const root = body && typeof body === "object" ? body as Record<string, unknown> : null;
    if (root?.success === false) return { status: "unknown", detail: "supersend_v2_failed_response" };
    return classifySupersendPayload(body);
  } catch (error) {
    return {
      status: "unknown",
      detail: error instanceof Error && error.name === "AbortError" ? "supersend_timeout" : "supersend_request_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}