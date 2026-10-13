import { randomBytes } from "node:crypto";

/** URL-safe random token for sessions and one-time links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
