import test from "node:test";import assert from "node:assert/strict";import { isValidEmail,normalizeEmail } from "../src/lib/contact-utils";
test("email normalization is stable",()=>assert.equal(normalizeEmail("  User.Name@GMAIL.COM  "),"user.name@gmail.com"));
test("basic email validation rejects malformed values",()=>{assert.equal(isValidEmail("person@example.com"),true);assert.equal(isValidEmail("missing-at.example.com"),false);assert.equal(isValidEmail("@example.com"),false)});
