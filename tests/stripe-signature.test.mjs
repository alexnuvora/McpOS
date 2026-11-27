import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "../src/lib/stripe-signature.mjs";
const secret = "whsec_fixture_only";
const now = 1795747200;
const raw = Buffer.from('{"id":"evt_test","livemode":false}');
const sign = (body, timestamp = now) => createHmac("sha256", secret).update(timestamp + ".").update(body).digest("hex");
const check = (body, header) => verifyStripeSignature(body, header, secret, now);
test("accepts valid exact-body signature and multiple v1 signatures", () => {
  assert.equal(check(raw, "t=" + now + ",v0=ignored,v1=" + "0".repeat(64) + ",v1=" + sign(raw)), true);
});
test("rejects tampering, v0 alone and malformed signatures", () => {
  assert.equal(check(Buffer.concat([raw, Buffer.from(" ")]), "t=" + now + ",v1=" + sign(raw)), false);
  assert.equal(check(raw, "t=" + now + ",v0=" + sign(raw)), false);
  assert.equal(check(raw, "t=" + now + ",v1=bad"), false);
});
test("rejects old or future signatures and duplicate timestamps", () => {
  for (const timestamp of [now - 301, now + 301]) assert.equal(check(raw, "t=" + timestamp + ",v1=" + sign(raw, timestamp)), false);
  assert.equal(check(raw, "t=" + now + ",t=" + now + ",v1=" + sign(raw)), false);
});
