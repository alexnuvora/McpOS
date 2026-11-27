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

test("renewal extends access only with a verified active subscription and a future period", () => {
  const originalEnd = now / 1000 + 86400;
  const renewedEnd = originalEnd + 30 * 86400;
  const afterRenewal = (originalEnd + 1) * 1000;
  assert.equal(resolveSubscription(prices,"price_pro","active",originalEnd,afterRenewal).active,false);
  assert.equal(resolveSubscription(prices,"price_pro","active",renewedEnd,afterRenewal).active,true);
  for (const status of ["past_due","unpaid","incomplete","canceled"]) {
    assert.equal(resolveSubscription(prices,"price_pro",status,renewedEnd,afterRenewal).active,false);
  }
});
test("recovery from failed renewal restores only valid paid access", () => {
  const end = now / 1000 + 30 * 86400;
  assert.equal(resolveSubscription(prices,"price_personal","past_due",end,now).active,false);
  assert.equal(resolveSubscription(prices,"price_personal","active",end,now).active,true);
  assert.equal(resolveSubscription(prices,"price_other","active",end,now).active,false);
});
