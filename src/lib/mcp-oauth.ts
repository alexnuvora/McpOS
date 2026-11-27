import { createHash, randomBytes } from "node:crypto";

export const MCP_SCOPES = [
  "workspace.read",
  "desktop.status",
  "screen.capture",
  "screen.accessibility",
  "files.read",
  "input.pointer",
  "input.keyboard",
  "browser.control",
] as const;

export type McpScope = typeof MCP_SCOPES[number];
const configuredIssuer = process.env.NEXT_PUBLIC_APP_URL || "https://mcpos-dashboard.netlify.app";
const issuerUrl = new URL(configuredIssuer);
if (issuerUrl.origin !== configuredIssuer.replace(/\/$/, "") || (issuerUrl.protocol !== "https:" && !(issuerUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(issuerUrl.hostname)))) {
  throw new Error("NEXT_PUBLIC_APP_URL must be a canonical HTTPS origin (or local test origin)");
}
export const MCP_ISSUER = issuerUrl.origin;
export const MCP_RESOURCE_URL = process.env.MCPOS_MCP_RESOURCE_URL || MCP_ISSUER + "/api/mcp";

export function hashOAuthToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newOAuthToken(prefix: string) {
  return prefix + randomBytes(32).toString("base64url");
}

export function parseScopes(value: string | null | undefined): string[] | null {
  const scopes = [...new Set((value || "workspace.read desktop.status").split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.some(scope => !MCP_SCOPES.includes(scope as McpScope))) return null;
  if (!scopes.includes("workspace.read")) scopes.unshift("workspace.read");
  return scopes;
}

export function isSafeRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function oauthError(error: string, description: string, status = 400) {
  return Response.json({ error, error_description: description }, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
