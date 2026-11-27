
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const base = process.env.MCPOS_TEST_APP_URL;
const db = process.env.MCPOS_TEST_SUPABASE_URL;
const key = process.env.MCPOS_TEST_SERVICE_ROLE_KEY;
for (const value of [base,db]) {
  const url = new URL(value);
  assert.equal(url.hostname,"127.0.0.1");
  assert.equal(url.protocol,"http:");
}
assert.equal(process.env.MCPOS_ENFORCE_SUBSCRIPTIONS,"true");
const admin = createClient(db,key,{auth:{persistSession:false,autoRefreshToken:false}});
test("unpaid account cannot enqueue any desktop tool under enforcement; workspace access remains available",async()=>{
  const created = await admin.auth.admin.createUser({email:"billing-ci@example.invalid",password:"fixture-"+randomUUID(),email_confirm:true});
  assert.ifError(created.error);
  const id = created.data.user.id;
  const token = "mcpos_"+randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const scopes = ["workspace.read","desktop.status","screen.capture","screen.accessibility","files.read","input.pointer","input.keyboard","browser.control"];
  try {
    const c = await admin.from("mcpos_mcp_clients").insert({user_id:id,client_name:"Enforcement CI",token_hash:hash,scopes});
    assert.ifError(c.error);
    const device = await admin.from("mcpos_devices").insert({user_id:id,device_name:"Enforcement fixture",status:"online",last_seen_at:new Date().toISOString()});
    assert.ifError(device.error);
    async function call(name,args={}) {
      const res = await fetch(base+"/api/mcp",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})});
      assert.equal(res.status,200);
      const body=await res.json();
      assert.ok(body.result,JSON.stringify(body.error??{}));
      return body.result;
    }
    assert.notEqual((await call("mcpos_status")).isError,true);
    for (const [name,args] of [
      ["mcpos_request_desktop_status",{}],
      ["mcpos_capture_screen",{}],
      ["mcpos_get_accessibility_snapshot",{}],
      ["mcpos_access_approved_files",{operation:"list_folders"}],
      ["mcpos_request_input_action",{action:"pointer_click",x:1,y:1}],
      ["mcpos_browser_automation",{action:"open",url:"https://example.com"}]
    ]) {
      const result=await call(name,args);
      assert.equal(result.isError,true,name);
      assert.match(result.content[0].text,/active McpOS subscription is required/,name);
    }
    const count = await admin.from("mcpos_device_commands").select("id",{count:"exact",head:true}).eq("user_id",id);
    assert.ifError(count.error);
    assert.equal(count.count,0);
  } finally {
    await admin.auth.admin.deleteUser(id);
  }
});
