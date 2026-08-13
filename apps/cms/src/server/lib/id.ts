/**
 * ULID generation.
 *
 * Lexicographically sortable, so `ORDER BY id` matches creation order and
 * pagination stays stable without a secondary sort. This is an identifier
 * encoding, not a cryptographic construction — the randomness comes from
 * `crypto.randomBytes`.
 */

import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

let lastTime = 0;
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let out = "";
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    out = ALPHABET[time % 32] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function randomChars(): number[] {
  const bytes = randomBytes(RANDOM_CHARS);
  return Array.from(bytes, (byte) => byte % 32);
}

/** Increments the random component so ids created in the same millisecond still sort. */
function bumpRandom(chars: number[]): number[] {
  const next = [...chars];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  return randomChars();
}

export function ulid(now = Date.now()): string {
  if (now === lastTime) {
    lastRandom = bumpRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomChars();
  }
  return encodeTime(now) + lastRandom.map((index) => ALPHABET[index]).join("");
}

export function isUlid(value: string): boolean {
  return value.length === 26 && [...value].every((char) => ALPHABET.includes(char));
}

/** URL-safe random token for sessions and one-time links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
