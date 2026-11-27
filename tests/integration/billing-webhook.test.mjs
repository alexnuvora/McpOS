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
  assert.equal((await fetch(base+"/api/billing/preflight")).status,401);
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
    const login = (payload, origin = base, cookie = "") => fetch(base+"/api/auth/login",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json",Cookie:cookie},body:JSON.stringify(payload)});
    const credentials = {action:"password",email,password,next:"/billing"};
    const missingRecovery = await fetch(base+"/auth/recovery?next=//evil.invalid",{redirect:"manual"});
    assert.equal(missingRecovery.status,307);
    assert.equal(missingRecovery.headers.get("location"),base+"/login?error=recovery");
    const invalidRecovery = await fetch(base+"/auth/recovery?code=invalid&next=//evil.invalid",{redirect:"manual"});
    assert.equal(invalidRecovery.status,307);
    assert.equal(invalidRecovery.headers.get("location"),base+"/login?error=recovery");
    assert.equal((await login(credentials,"https://wrong-origin.invalid")).status,403);
    assert.equal((await login({...credentials,password:"incorrect-password"})).status,401);
    assert.equal((await login({...credentials,email:"not-allowed@example.invalid"})).status,401);
    const deniedRegistration = await login({action:"register",email:"not-allowed@example.invalid",password:"test-password-123"});
    assert.equal(deniedRegistration.status,200);
    assert.deepEqual(await deniedRegistration.json(),{ok:true});
    assert.equal((await login({action:"register",email,password:"short"})).status,400);
    const appLogin = await login({...credentials,next:"//evil.invalid"});
    assert.equal(appLogin.status,200);
    assert.equal((await appLogin.json()).next,"/");
    const appCookies = appLogin.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
    assert.ok(appCookies);
    assert.equal((await fetch(base+"/api/billing/status",{headers:{Cookie:appCookies}})).status,200);
    const updatePassword = (payload, cookie="", origin=base) => fetch(base+"/api/auth/password",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json",Cookie:cookie},body:JSON.stringify(payload)});
    assert.equal((await updatePassword({password:"replacement-password-123"})).status,401);
    assert.equal((await updatePassword({password:"replacement-password-123"},appCookies,"https://wrong-origin.invalid")).status,403);
    assert.equal((await updatePassword({password:"short"},appCookies)).status,400);
    const signed = await auth.auth.signInWithPassword({email,password});
    assert.ifError(signed.error);
    const cookie = [...cookies].map(([name,value]) => name + "=" + value).join("; ");
    assert.ok(cookie);
    const preflight = await fetch(base+"/api/billing/preflight",{headers:{Cookie:cookie}});
    assert.equal(preflight.status,200);
    const readiness = await preflight.json();
    assert.equal(readiness.readyForPreviewCheckout,false);
    assert.equal(readiness.checks.ledgerReady,true);
    assert.equal(readiness.checks.reservationsReady,true);
    assert.equal(readiness.checks.quotasReady,true);
    assert.equal(readiness.checks.stripeAccountVerified,false);
    assert.ok(!JSON.stringify(readiness).includes("sk_test_"));
    assert.ok(!JSON.stringify(readiness).includes("whsec_"));
    const status = await fetch(base+"/api/billing/status",{headers:{Cookie:cookie}});
    assert.equal(status.status,200);
    assert.equal((await status.json()).subscriptions.length,0,"another account's ledger must not be visible");
    const request = (path, payload, origin = base) => fetch(base+path,{method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(payload)});
    assert.equal((await request("/api/billing/checkout",{plan:"personal"},"https://wrong-origin.invalid")).status,403);
    assert.equal((await request("/api/billing/checkout",{plan:"invalid-plan"})).status,400);
    assert.equal((await request("/api/billing/portal",{subscriptionId:stripeId})).status,404,"another account's subscription must not be accessible");
    // Full PKCE recovery with an actual email captured in the isolated local SMTP inbox.
    const recovery = await login({action:"recovery",email});
    assert.equal(recovery.status,200);
    const recoveryCookie = recovery.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
    assert.ok(recoveryCookie,"PKCE verifier cookie must be set");
    let mail;
    for (let i=0; i<20 && !mail; i++) {
      const inbox = await fetch("http://127.0.0.1:54324/api/v1/messages");
      assert.equal(inbox.status,200);
      const messages = (await inbox.json()).messages;
      mail = messages?.find(m=>m.To?.some(to=>to.Address===email) && /reset|recovery/i.test(m.Subject));
      if (!mail) await new Promise(resolve=>setTimeout(resolve,500));
    }
    assert.ok(mail,"Recovery email must arrive in the local inbox");
    const detail = await fetch("http://127.0.0.1:54324/api/v1/message/"+encodeURIComponent(mail.ID));
    assert.equal(detail.status,200);
    const message = await detail.json();
    const hrefs = [...(message.HTML || "").matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1].replaceAll("&amp;","&"));
    const link = hrefs.map(href=>{try{return new URL(href)}catch{return null}}).find(url=>url?.origin===db && url.pathname==="/auth/v1/verify" && url.searchParams.get("type")==="recovery");
    assert.ok(link,"Recovery mail must link to local Supabase verification");
    assert.equal(link.searchParams.get("redirect_to"),base+"/auth/recovery");
    const verified = await fetch(link,{redirect:"manual"});
    assert.ok([302,303,307].includes(verified.status));
    const callback = new URL(verified.headers.get("location"));
    assert.ok(callback.origin===base && callback.pathname==="/auth/recovery" && callback.searchParams.has("code"),"Verification must return a local PKCE callback");
    const recovered = await fetch(callback,{redirect:"manual",headers:{Cookie:recoveryCookie}});
    assert.equal(recovered.status,307);
    assert.equal(recovered.headers.get("location"),base+"/reset-password");
    const recoverySession = recovered.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
    assert.ok(recoverySession,"Verified recovery must create a session");
    assert.equal((await fetch(base+"/reset-password",{headers:{Cookie:recoverySession}})).status,200);
    const replacement = "replacement-" + randomUUID();
    assert.equal((await updatePassword({password:replacement},recoverySession)).status,200);
    assert.equal((await login(credentials)).status,401);
    assert.equal((await login({...credentials,password:replacement})).status,200);
  } finally {
    await admin.auth.admin.deleteUser(created.data.user.id);
  }
});

test("public OAuth endpoints reject oversized and ambiguous payloads before database access", async () => {
  for (const path of ["/oauth/token","/oauth/revoke"]) {
    const request = body => fetch(base+path,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
    assert.equal((await request("client_id="+ "a".repeat(17000))).status,413);
    assert.equal((await request("client_id=a&client_id=b")).status,400);
  }
  const register = body => fetch(base+"/oauth/register",{method:"POST",headers:{"Content-Type":"application/json"},body});
  assert.equal((await register(JSON.stringify({client_name:"x".repeat(50000)}))).status,413);
  assert.equal((await register("null")).status,400);
  assert.equal((await register("[]")).status,400);
});
