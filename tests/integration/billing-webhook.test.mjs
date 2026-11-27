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

test("authenticated billing checks are scoped to the signed-in account", async () => {
  const { createServerClient } = await import("@supabase/ssr");
  const { createClient } = await import("@supabase/supabase-js");
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.ok(publishable);
  const admin = createClient(db, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = "billing-ci@example.invalid";
  const password = "fixture-" + randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  assert.ok(created.data.user);
  const cookies = new Map();
  const auth = createServerClient(db, publishable, { cookies: {
    getAll: () => [...cookies].map(([name,value]) => ({ name,value })),
    setAll: entries => entries.forEach(({name,value}) => cookies.set(name,value)),
  } });
  try {
    const signed = await auth.auth.signInWithPassword({email,password});
    assert.ifError(signed.error);
    const cookie = [...cookies].map(([name,value]) => name + "=" + value).join("; ");
    assert.ok(cookie);
    const status = await fetch(base+"/api/billing/status",{headers:{Cookie:cookie}});
    assert.equal(status.status,200);
    assert.equal((await status.json()).subscriptions.length,0,"another account's ledger must not be visible");
    const request = (path, payload, origin = base) => fetch(base+path,{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(payload)});
    assert.equal((await request("/api/billing/checkout",{plan:"personal"},"https://wrong-origin.invalid")).status,403);
    assert.equal((await request("/api/billing/checkout",{plan:"invalid-plan"})).status,400);
    assert.equal((await request("/api/billing/portal",{subscriptionId:stripeId})).status,404,"another account's subscription must not be accessible");
  } finally {
    await admin.auth.admin.deleteUser(created.data.user.id);
  }
});
