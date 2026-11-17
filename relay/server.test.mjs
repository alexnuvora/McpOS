import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";

const DEVICE_ID = "device-12345678";
const DEVICE_TOKEN = "d".repeat(48);
const RELAY_SECRET = "r".repeat(48);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

test("relay authenticates a paired device and returns command results", async t => {
  const supabasePort = await freePort();
  const relayPort = await freePort();
  const mockSupabase = http.createServer((req, res) => {
    if (req.url === "/functions/v1/device-heartbeat" && req.method === "POST" &&
        req.headers.authorization === "Bearer " + DEVICE_TOKEN) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, device_id: DEVICE_ID }));
      return;
    }
    res.writeHead(401);
    res.end("{}");
  });
  mockSupabase.listen(supabasePort, "127.0.0.1");
  await once(mockSupabase, "listening");

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      PORT: String(relayPort),
      SUPABASE_URL: "http://127.0.0.1:" + supabasePort,
      MCPOS_RELAY_SECRET: RELAY_SECRET,
    },
    stdio: "ignore",
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => {});
    }
    await new Promise(resolve => mockSupabase.close(resolve));
  });

  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:" + relayPort + "/health");
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "relay should start");

  const health = await fetch("http://127.0.0.1:" + relayPort + "/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, "mcpos-relay");

  const unauthorized = await fetch("http://127.0.0.1:" + relayPort + "/internal/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: DEVICE_ID, command: "capture_screen", args: {} }),
  });
  assert.equal(unauthorized.status, 401);

  const offline = await fetch("http://127.0.0.1:" + relayPort + "/internal/command", {
    method: "POST",
    headers: { authorization: "Bearer " + RELAY_SECRET, "content-type": "application/json" },
    body: JSON.stringify({ deviceId: DEVICE_ID, command: "capture_screen", args: {} }),
  });
  assert.equal(offline.status, 409);

  const socket = new WebSocket("ws://127.0.0.1:" + relayPort + "/relay/device", {
    headers: { authorization: "Bearer " + DEVICE_TOKEN, "x-device-id": DEVICE_ID },
  });
  const connectedMessage = once(socket, "message");
  await once(socket, "open");
  const connected = JSON.parse((await connectedMessage)[0].toString());
  assert.equal(connected.type, "connected");
  assert.equal(connected.deviceId, DEVICE_ID);

  const incomingMessage = once(socket, "message");
  const commandPromise = fetch("http://127.0.0.1:" + relayPort + "/internal/command", {
    method: "POST",
    headers: { authorization: "Bearer " + RELAY_SECRET, "content-type": "application/json" },
    body: JSON.stringify({ deviceId: DEVICE_ID, command: "inspect_application", args: { appName: "notepad" } }),
  });

  const incoming = JSON.parse((await incomingMessage)[0].toString());
  assert.equal(incoming.type, "command");
  assert.equal(incoming.command, "inspect_application");
  socket.send(JSON.stringify({ type: "result", id: incoming.id, ok: true, result: "window tree" }));

  const response = await commandPromise;
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.result, "window tree");
  const closed = once(socket, "close");
  socket.close();
  await closed;
});
