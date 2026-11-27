import test from "node:test";
import assert from "node:assert/strict";
import { hostedSandboxOriginAllowed, sandboxOriginEnabled } from "../src/lib/sandbox-origin-policy.mjs";

const vercel = "https://mcpos-dashboard.vercel.app";
const netlify = "https://deploy-preview-12--mcpos-dashboard.netlify.app";
const env = { VERCEL_ENV: "production", MCPOS_BILLING_ENABLED: "true" };

test("Vercel sandbox requires exact origin, production target and explicit enable", () => {
  assert.equal(sandboxOriginEnabled(env, vercel), true);
  assert.equal(hostedSandboxOriginAllowed(env, vercel), true);
  for (const e of [{...env, VERCEL_ENV:"preview"}, {...env, MCPOS_BILLING_ENABLED:"false"}, {VERCEL_ENV:"production"}, {...env, MCPOS_BUILD_PREVIEW_ORIGIN:netlify}]) {
    assert.equal(sandboxOriginEnabled(e, vercel), false);
  }
  assert.equal(sandboxOriginEnabled(env, "https://other.vercel.app"), false);
  assert.equal(sandboxOriginEnabled(env, vercel + ".example.org"), false);
});
test("legacy preview and local fixture preserve existing gates", () => {
  assert.equal(sandboxOriginEnabled({MCPOS_BUILD_PREVIEW_ORIGIN:netlify}, netlify), true);
  assert.equal(sandboxOriginEnabled({MCPOS_BUILD_PREVIEW_ORIGIN:netlify, MCPOS_BILLING_ENABLED:"false"}, netlify), false);
  assert.equal(sandboxOriginEnabled({MCPOS_BILLING_ENABLED:"true"}, "http://127.0.0.1:3000"), true);
  assert.equal(hostedSandboxOriginAllowed(env, "http://127.0.0.1:3000"), false);
});
