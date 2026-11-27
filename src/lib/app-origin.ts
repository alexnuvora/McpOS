// Only the explicitly approved preview origin may override the configured app URL.
export function mcposAppOrigin(): string | null {
  const configured = process.env.MCPOS_BUILD_PREVIEW_ORIGIN || process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) return null;
    return url.origin;
  } catch { return null; }
}
