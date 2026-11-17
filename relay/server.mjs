import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const RELAY_SECRET = process.env.MCPOS_RELAY_SECRET || "";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 45_000;

const devices = new Map();
const pending = new Map();
if (!RELAY_SECRET || RELAY_SECRET.length < 32) throw new Error("MCPOS_RELAY_SECRET must contain at least 32 characters.");
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required.");

const allowedCommands = new Set([
  "capture_screen",
  "inspect_application",
  "click_application",
  "type_application_text",
  "press_application_key",
]);

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateCommand(body) {
  if (!body || typeof body !== "object") throw new Error("Invalid command body.");
  const { deviceId, command, args = {} } = body;
  if (typeof deviceId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(deviceId)) {
    throw new Error("Invalid device ID.");
  }
  if (!allowedCommands.has(command)) throw new Error("Command is not allowed.");
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid command arguments.");
  const appName = args.appName;
  if (command !== "capture_screen" && (typeof appName !== "string" || !appName.trim() || appName.length > 128)) {
    throw new Error("A valid application name is required.");
  }
  if (command === "click_application" && (!Number.isFinite(args.x) || !Number.isFinite(args.y))) {
    throw new Error("Invalid pointer coordinates.");
  }
  if (command === "type_application_text" && (typeof args.value !== "string" || args.value.length > 4000)) {
    throw new Error("Text must be a string of at most 4,000 characters.");
  }
  if (command === "press_application_key" && (typeof args.key !== "string" || !args.key.trim() || args.key.length > 64)) {
    throw new Error("Invalid key chord.");
  }
  return { deviceId, command, args };
}

async function authenticateDevice(deviceId, token) {
  if (!SUPABASE_URL || !token || token.length < 40) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/device-heartbeat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data?.ok === true && data?.device_id === deviceId;
  } catch {
    return false;
  }
}

function rejectDevicePending(deviceId, message) {
  for (const [id, item] of pending) {
    if (item.deviceId === deviceId) {
      clearTimeout(item.timer);
      pending.delete(id);
      item.reject(new Error(message));
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, service: "mcpos-relay", connectedDevices: devices.size, pendingCommands: pending.size });
  }
  if (req.method !== "POST" || req.url !== "/internal/command") {
    return json(res, 404, { error: "Not found." });
  }
  if (!safeEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ""), RELAY_SECRET)) {
    return json(res, 401, { error: "Unauthorized." });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return json(res, 400, { error: error.message || "Invalid JSON." });
  }

  let command;
  try {
    command = validateCommand(body);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }

  const socket = devices.get(command.deviceId);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return json(res, 409, { error: "The selected desktop is offline." });
  }

  const id = crypto.randomUUID();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Desktop did not respond before the command timed out."));
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, { deviceId: command.deviceId, resolve, reject, timer });
  });

  try {
    socket.send(JSON.stringify({ type: "command", id, command: command.command, args: command.args }));
    const response = await result;
    return json(res, 200, { ok: true, deviceId: command.deviceId, result: response });
  } catch (error) {
    return json(res, 504, { error: error.message || "Desktop command failed." });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RESPONSE_BYTES });

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/relay/device") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const deviceId = req.headers["x-device-id"];
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (typeof deviceId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(deviceId) || !(await authenticateDevice(deviceId, token))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    const previous = devices.get(deviceId);
    if (previous && previous !== ws) previous.close(4001, "Replaced by a newer desktop session.");
    devices.set(deviceId, ws);
    ws.send(JSON.stringify({ type: "connected", deviceId }));

    ws.on("message", raw => {
      let message;
      try { message = JSON.parse(raw.toString("utf8")); } catch { return; }
      if (message?.type !== "result" || typeof message.id !== "string") return;
      const item = pending.get(message.id);
      if (!item || item.deviceId !== deviceId) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.ok === true) item.resolve(message.result ?? null);
      else item.reject(new Error(typeof message.error === "string" ? message.error.slice(0, 500) : "Desktop action was denied or failed."));
    });

    ws.on("close", () => {
      if (devices.get(deviceId) === ws) {
        devices.delete(deviceId);
        rejectDevicePending(deviceId, "Desktop disconnected before responding.");
      }
    });
    ws.on("error", () => {
      if (devices.get(deviceId) === ws) {
        devices.delete(deviceId);
        rejectDevicePending(deviceId, "Desktop relay connection failed.");
      }
    });
  });
});

const keepAlive = setInterval(() => {
  for (const [deviceId, ws] of devices) {
    if (ws.readyState !== WebSocket.OPEN) {
      devices.delete(deviceId);
      rejectDevicePending(deviceId, "Desktop connection is no longer available.");
      continue;
    }
    ws.ping();
  }
}, 30_000);

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`McpOS relay listening on ${PORT}\n`);
});

function shutdown() {
  clearInterval(keepAlive);
  for (const ws of devices.values()) ws.close(1001, "Relay shutting down.");
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error("Relay is shutting down."));
  }
  pending.clear();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
