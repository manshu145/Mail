import test from "node:test";
import assert from "node:assert/strict";
import { getAuthSecret, getLoginErrorMessage, isDemoAuthEnabled } from "../src/lib/auth-policy";

const demo = { NEXIMAIL_DEMO_MODE: "true", NODE_ENV: "development" };

test("demo auth requires explicit opt-in and no database", () => {
  assert.equal(isDemoAuthEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isDemoAuthEnabled(demo), true);
  assert.equal(isDemoAuthEnabled({ ...demo, DATABASE_URL: "postgres://localhost/app" }), false);
  assert.equal(isDemoAuthEnabled({ ...demo, NEXIMAIL_DEMO_MODE: "false" }), false);
});

test("production and ambiguous environments cannot use demo auth", () => {
  assert.equal(isDemoAuthEnabled({ ...demo, NODE_ENV: "production" }), false);
  assert.equal(isDemoAuthEnabled({ NEXIMAIL_DEMO_MODE: "true" }), false);
  for (const VERCEL_ENV of [undefined, "development"]) {
    assert.equal(isDemoAuthEnabled({ ...demo, VERCEL: "1", VERCEL_ENV }), false);
  }
  assert.equal(
    isDemoAuthEnabled({
      ...demo,
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "unrelated-project.vercel.app",
    }),
    false,
  );
});

test("Vercel preview permits opt-in demo even with a production Node build", () => {
  const preview = { ...demo, NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" };
  assert.equal(isDemoAuthEnabled(preview), true);
  assert.equal(isDemoAuthEnabled({ ...preview, DATABASE_URL: "postgres://localhost/app" }), false);
  assert.equal(isDemoAuthEnabled({ ...preview, NEXIMAIL_DEMO_MODE: "false" }), false);
});

test("dedicated stable NexiMail preview URL permits opt-in demo auth", () => {
  const stablePreview = {
    ...demo,
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "neximail-preview.vercel.app",
  };

  assert.equal(isDemoAuthEnabled(stablePreview), true);
  assert.equal(isDemoAuthEnabled({ ...stablePreview, DATABASE_URL: "postgres://localhost/app" }), false);
  assert.equal(isDemoAuthEnabled({ ...stablePreview, NEXIMAIL_DEMO_MODE: "false" }), false);
});

test("every environment requires its own sufficiently long signing secret", () => {
  for (const AUTH_SECRET of [undefined, "", "x".repeat(31)]) {
    assert.throws(() => getAuthSecret({ AUTH_SECRET }), /AUTH_SECRET/);
    assert.throws(() => getAuthSecret({ ...demo, VERCEL: "1", VERCEL_ENV: "preview", AUTH_SECRET }), /AUTH_SECRET/);
  }
  assert.deepEqual(getAuthSecret({ AUTH_SECRET: "a".repeat(32) }), new TextEncoder().encode("a".repeat(32)));
  assert.notDeepEqual(getAuthSecret({ AUTH_SECRET: "a".repeat(32) }), getAuthSecret({ AUTH_SECRET: "b".repeat(32) }));
});

test("login distinguishes operational failures without exposing internal details", () => {
  assert.match(getLoginErrorMessage("rate"), /10 minutes/);
  assert.match(getLoginErrorMessage("config"), /administrator/);
  assert.match(getLoginErrorMessage("1"), /Invalid credentials/);
  assert.equal(getLoginErrorMessage("untrusted input"), getLoginErrorMessage("1"));
});
