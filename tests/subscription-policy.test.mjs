import test from "node:test";
import assert from "node:assert/strict";
import { resolveSubscription } from "../src/lib/subscription-policy.mjs";
const prices = { personal: "price_personal", professional: "price_pro", business: undefined };
const now = 1795747200000;
const future = now / 1000 + 60;
test("allows known active unexpired subscription", () => {
  assert.deepEqual(resolveSubscription(prices, "price_pro", "active", future, now), {plan:"professional",active:true});
});
test("denies cancelled, unpaid, incomplete, past due, paused and trialing subscriptions", () => {
  for (const status of ["canceled","unpaid","incomplete","incomplete_expired","past_due","paused","trialing"]) assert.equal(resolveSubscription(prices,"price_pro",status,future,now).active,false);
});
test("denies expired, missing and invalid period ends", () => {
  for (const end of [now / 1000, now / 1000 - 1, null, NaN, Infinity]) assert.equal(resolveSubscription(prices,"price_pro","active",end,now).active,false);
});
test("denies unknown or unconfigured prices", () => {
  assert.deepEqual(resolveSubscription(prices,"price_other","active",future,now),{plan:null,active:false});
  assert.equal(resolveSubscription(prices,"","active",future,now).active,false);
});
