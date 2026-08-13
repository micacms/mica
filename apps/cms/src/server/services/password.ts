/**
 * Password hashing.
 *
 * scrypt (RFC 7914) via Node's OpenSSL binding — a proven implementation, and
 * the only memory-hard KDF available without a native dependency. Nothing here
 * invents cryptography: it selects parameters, generates a salt and compares in
 * constant time.
 *
 * Stored format (PHC-like, self-describing so parameters can be raised later
 * without invalidating existing hashes):
 *
 *   scrypt$N=32768,r=8,p=1$<salt base64url>$<derived key base64url>
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** ~32 MiB and ~100 ms per hash on current hardware. */
const CURRENT: ScryptParams = { N: 32768, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const maxmem = (params: ScryptParams): number => 256 * params.N * params.r;

async function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  // Normalising means "café" typed on two different keyboards still matches.
  return scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...params,
    maxmem: maxmem(params),
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, CURRENT);
  const { N, r, p } = CURRENT;
  return `scrypt$N=${N},r=${r},p=${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return null;

  const params: Partial<ScryptParams> = {};
  for (const pair of parts[1]!.split(",")) {
    const [name, raw] = pair.split("=");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    if (name === "N" || name === "r" || name === "p") params[name] = value;
  }
  if (!params.N || !params.r || !params.p) return null;

  // Guard against a tampered record demanding an absurd allocation.
  if (params.N > 2 ** 22 || params.r > 32 || params.p > 16) return null;

  return {
    params: params as ScryptParams,
    salt: Buffer.from(parts[2]!, "base64url"),
    key: Buffer.from(parts[3]!, "base64url"),
  };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);

  if (!parsed) {
    // Spend comparable time on a malformed hash so a corrupt or missing record
    // is not distinguishable from a wrong password by response timing.
    await derive(password, randomBytes(SALT_LENGTH), CURRENT);
    return false;
  }

  const candidate = await derive(password, parsed.salt, parsed.params);
  if (candidate.length !== parsed.key.length) return false;
  return timingSafeEqual(candidate, parsed.key);
}

/** True when a stored hash uses weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return (
    parsed.params.N < CURRENT.N || parsed.params.r < CURRENT.r || parsed.params.p < CURRENT.p
  );
}

/* ------------------------------------------------------------------ *
 * Policy
 * ------------------------------------------------------------------ */

export const MIN_PASSWORD_LENGTH = 10;

const COMMON = new Set([
  "password",
  "password1",
  "passwort",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "qwertzuiop",
  "letmein123",
  "administrator",
]);

/** Returns a human-readable problem, or null when the password is acceptable. */
export function checkPasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) {
    return "Use at most 200 characters.";
  }
  if (COMMON.has(password.toLowerCase())) {
    return "This password is too common. Choose something less predictable.";
  }
  if (/^(.)\1+$/.test(password)) {
    return "Choose a password with more variety.";
  }
  return null;
}
