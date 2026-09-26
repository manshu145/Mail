export type ValidationMode = "internal" | "hybrid" | "supersend";

export const VALIDATION_MODE_KEY = "validation.mode";
export const DEFAULT_VALIDATION_MODE: ValidationMode = "hybrid";

export function normalizeValidationMode(value: unknown): ValidationMode {
  return value === "hybrid" || value === "supersend" ? value : "internal";
}

// Smart Hybrid is the production default: Internal first, SuperSend fallback for inconclusive results.\nexport function validationModeLabel(mode: ValidationMode) {
  if (mode === "hybrid") return "Smart hybrid";
  if (mode === "supersend") return "SuperSend primary";
  return "NexiMail internal";
}

export function validationModeNeedsSupersend(mode: ValidationMode) {
  return mode === "hybrid" || mode === "supersend";
}
