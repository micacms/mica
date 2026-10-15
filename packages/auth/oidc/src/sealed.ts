/**
 * Values that only this Mica can read or make: AES-256-GCM under a key that
 * HKDF derives from MICA_SESSION_SECRET, one key for each purpose. A fresh
 * random IV each time; the tag refuses a forged or altered value.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A key for one purpose. The same secret never encrypts two kinds of value (#91). */
export function sealingKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", purpose, 32));
}

/** The value as JSON, encrypted, in base64url: IV, ciphertext, tag. */
export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** The JSON text of a sealed value, or null for a forged, truncated or rotated one. */
export function unseal(key: Buffer, sealed: string): string | null {
  const raw = Buffer.from(sealed, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
