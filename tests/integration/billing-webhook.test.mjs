import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const base = process.env.MCPOS_TEST_APP_URL;
const db = process.env.MCPOS_TEST_SUPABASE_URL;
const key = process.env.MCPOS_TEST_SERVICE_ROLE_KEY;
const secret = process.env.MCPOS_TEST_WEBHOOK_SECRET;
const userId = process.env.MCPOS_TEST_USER_ID;
const price = process.env.MCPOS_TEST_PRICE;
if (!base || !db || !key || !secret || !userId || !price) throw new Error("Missing isolated integration test configuration");
for (const url of [base, db]) {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:") throw new Error("Integration tests must use loopback services only");
}
const stripeId = "sub_" + randomUUID().replaceAll("-", "");
const event = {
  id: "evt_" + randomUUID().replaceAll("-", ""),
  type: "customer.subscription.created", created: Math.floor(Date.now() / 1000), livemode: false,
  data: { object: { id: stripeId, object: "subscription", livemode: false, customer: "cus_CIFixture", status: "active",
    metadata: { mcpos_user_id: userId }, items: { data: [{ price: { id: price }, current_period_end: Math.floor(Date.now()/1000)+3600 }] } } },
};
async function deliver(payload, valid = true) {
  const raw = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now()/1000);
  const digest = createHmac("sha256", secret).update(timestamp + "." + raw).digest("hex");
  return fetch(base + "/api/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": "t=" + timestamp + ",v1=" + (valid ? digest : "0".repeat(64)) }, body: raw });
}
async function ledger() {
  const res = await fetch(db + "/rest/v1/mcpos_billing_events?select=event_id,stripe_status&stripe_subscription_id=eq." + stripeId, { headers: { apikey: key, Authorization: "Bearer " + key } });
  assert.equal(res.status,200);
  return res.json();
}
test("signed billing webhook: invalid signature, live rejection, replay and cancellation", async () => {
  assert.equal((await deliver(event,false)).status,400);
  assert.equal((await deliver({...event,livemode:true})).status,400);
  assert.equal((await ledger()).length,0);
  const unrelated = structuredClone(event);
  unrelated.data.object.metadata = {};
  assert.equal((await deliver(unrelated)).status,200);
  assert.equal((await ledger()).length,0);
  assert.equal((await deliver(event)).status,200);
  assert.equal((await deliver(event)).status,200);
  assert.equal((await ledger()).length,1);
  const canceled = structuredClone(event);
  canceled.id = "evt_" + randomUUID().replaceAll("-", "");
  canceled.type = "customer.subscription.deleted";
  canceled.data.object.status = "canceled";
  assert.equal((await deliver(canceled)).status,200);
  const rows = await ledger();
  assert.equal(rows.length,2);
  assert.deepEqual(new Set(rows.map(r=>r.stripe_status)),new Set(["active","canceled"]));
});
test("unauthenticated billing status and checkout are denied", async () => {
  assert.equal((await fetch(base+"/api/billing/status")).status,401);
  assert.equal((await fetch(base+"/api/billing/checkout",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify({plan:"personal"})})).status,401);
});
