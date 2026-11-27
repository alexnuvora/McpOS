import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validate Stripe's v1 HMAC over the exact request bytes.
 * @param {Buffer} raw
 * @param {string} header
 * @param {string} secret
 * @param {number} nowSeconds
 */
export function verifyStripeSignature(raw, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret.startsWith("whsec_") || !header || header.length > 8192) return false;
  const entries = header.split(",").map(part => part.trim());
  const timestamps = entries.filter(part => part.startsWith("t=")).map(part => part.slice(2));
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0])) return false;
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(timestamps[0] + ".").update(raw).digest();
  return entries.filter(part => /^v1=[0-9a-f]{64}$/i.test(part)).some(part => {
    const actual = Buffer.from(part.slice(3), "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
