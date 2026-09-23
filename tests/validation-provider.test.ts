import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_VALIDATION_MODE,
  normalizeValidationMode,
  validationModeNeedsSupersend,
  validationModeLabel,
} from "../src/lib/validation-provider";

test("validation mode defaults safely to NexiMail internal", () => {
  assert.equal(DEFAULT_VALIDATION_MODE, "internal");
  assert.equal(normalizeValidationMode(undefined), "internal");
  assert.equal(normalizeValidationMode("bogus"), "internal");
});

test("validation modes normalize and describe provider requirements", () => {
  assert.equal(normalizeValidationMode("hybrid"), "hybrid");
  assert.equal(normalizeValidationMode("supersend"), "supersend");
  assert.equal(validationModeNeedsSupersend("internal"), false);
  assert.equal(validationModeNeedsSupersend("hybrid"), true);
  assert.equal(validationModeNeedsSupersend("supersend"), true);
  assert.equal(validationModeLabel("internal"), "NexiMail internal");
  assert.equal(validationModeLabel("hybrid"), "Smart hybrid");
  assert.equal(validationModeLabel("supersend"), "SuperSend primary");
});
