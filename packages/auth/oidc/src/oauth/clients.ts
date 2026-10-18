/**
 * Who an agent's client is, without a table of clients.
 *
 *   - A Client ID Metadata Document: the client ID is an https address, and
 *     the document there names the client and its redirect URIs. Mica fetches
 *     it when it needs it. This is what the MCP specification prefers.
 *   - Dynamic registration, for clients that cannot do the above: Mica seals
 *     what the client registered into the client ID itself, and stores nothing.
 *     The name in it is only what the client said about itself.
 */

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import { BlockList, isIP } from "node:net";

import { seal, sealingKey, unseal } from "../sealed.js";

export interface Client {
  id: string;
  name: string;
  redirectUris: string[];
  /** The ID is an address that serves the document: the name is that site's own statement. */
  verified: boolean;
}

export class ClientError extends Error {
  override name = "ClientError";
}

/** The prefix of a client ID that Mica made at registration. */
const REGISTERED_PREFIX = "mica-client.";

const MAX_DOCUMENT_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_MS = 5 * 60_000;
const CACHE_ENTRIES = 100;

/** Schemes a browser must never be sent to with a code. */
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A redirect URI that may receive a code: https, http to this machine only, or
 * a native app's own scheme. Never a fragment (OAuth 2.1).
 */
export function checkRedirectUri(value: string): string | null {
  if (!URL.canParse(value)) return `"${value}" is not an address.`;
  const url = new URL(value);
  if (url.hash) return `"${value}" has a fragment.`;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return `"${value}" cannot receive a code.`;
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) return `"${value}" must use https, or point at this machine.`;
  return null;
}

/**
 * The registered redirect URI that `requested` matches, or null. A loopback
 * address matches on any port, because a native app picks a free port when it
 * starts (RFC 8252, section 7.3).
 */
export function matchRedirectUri(client: Client, requested: string): string | null {
  if (client.redirectUris.includes(requested)) return requested;
  if (!URL.canParse(requested)) return null;
  const asked = new URL(requested);
  if (asked.protocol !== "http:" || !LOOPBACK_HOSTS.has(asked.hostname)) return null;
  // Only the port may differ: a fragment or a user name is not part of a registered address.
  if (asked.hash || asked.username || asked.password) return null;
  const match = client.redirectUris.some((registered) => {
    if (!URL.canParse(registered)) return false;
    const url = new URL(registered);
    return url.protocol === "http:" && url.hostname === asked.hostname && url.pathname === asked.pathname && url.search === asked.search;
  });
  return match ? requested : null;
}

/* ------------------------------------------------------------------ *
 * Fetching a metadata document
 * ------------------------------------------------------------------ */

/** Addresses that are not on the public internet: Mica must not fetch from its own network. */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // NAT64, local NAT64, IPv4-compatible and 6to4 addresses carry an IPv4 address, which may be a private one.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["::", 96],
  ["2002::", 16],
  // Discard-only, documentation and the old site-local range: never a client's server.
  ["100::", 64],
  ["2001:db8::", 32],
  ["fec0::", 10],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  // An IPv4 address in IPv6 form is checked as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return !PRIVATE.check(mapped, "ipv4");
  const family = isIP(address);
  if (family === 0) return false;
  return !PRIVATE.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** A DNS lookup that refuses a private address, at connect time, so a rebound name cannot slip through. */
function publicLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    const refused = addresses.find((entry) => !isPublicAddress(entry.address));
    if (refused || addresses.length === 0) {
      return callback(Object.assign(new Error(`${hostname} is not a public address.`), { code: "EREFUSED" }), []);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

/** GETs a JSON document over https: no redirect, a small size, a short time. */
export function fetchJson(url: URL): Promise<unknown> {
  // Node skips the lookup for an address in the URL itself, so that address is checked here.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) !== 0 && !isPublicAddress(literal)) {
    return Promise.reject(new ClientError(`${url.hostname} is not a public address.`));
  }
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { lookup: publicLookup as never, timeout: FETCH_TIMEOUT_MS, headers: { accept: "application/json" } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          return reject(new ClientError(`${url.href} answered ${response.statusCode}.`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_DOCUMENT_BYTES) {
            request.destroy(new ClientError(`${url.href} is larger than ${MAX_DOCUMENT_BYTES / 1024} kB.`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new ClientError(`${url.href} is not JSON.`));
          }
        });
      },
    );
    // `timeout` is only the idle time of the socket; this ends a slow answer too.
    const deadline = setTimeout(() => request.destroy(new ClientError(`${url.href} did not answer in time.`)), FETCH_TIMEOUT_MS);
    request.on("close", () => clearTimeout(deadline));
    request.on("timeout", () => request.destroy(new ClientError(`${url.href} did not answer in time.`)));
    request.on("error", (error) => reject(error instanceof ClientError ? error : new ClientError(`${url.href} cannot be read: ${error.message}`)));
  });
}

/* ------------------------------------------------------------------ *
 * Resolving a client ID
 * ------------------------------------------------------------------ */

/** A client ID that names a metadata document: https, with a path, nothing else. */
function documentUrl(clientId: string): URL | null {
  if (!clientId.startsWith("https://") || !URL.canParse(clientId)) return null;
  const url = new URL(clientId);
  if (url.pathname === "/" || url.hash || url.username || url.password || url.href !== clientId) return null;
  return url;
}

function redirectUrisOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((entry) => typeof entry === "string")) {
    throw new ClientError("The client has no redirect_uris.");
  }
  for (const uri of value as string[]) {
    const problem = checkRedirectUri(uri);
    if (problem) throw new ClientError(problem);
  }
  return value as string[];
}

const nameOf = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : fallback;

export interface ClientsDeps {
  secret: string;
  /** Replaces the https fetch in tests. */
  fetchDocument?: (url: URL) => Promise<unknown>;
}

export function createClients(deps: ClientsDeps) {
  const key = sealingKey(deps.secret, "mica agent clients v1");
  const fetchDocument = deps.fetchDocument ?? fetchJson;
  const cache = new Map<string, { client: Client; until: number }>();

  const fromDocument = async (url: URL): Promise<Client> => {
    const cached = cache.get(url.href);
    if (cached && cached.until > Date.now()) return cached.client;

    const document = (await fetchDocument(url).catch((error: unknown) => {
      throw error instanceof ClientError ? error : new ClientError(`${url.href} cannot be read.`);
    })) as Record<string, unknown> | null;
    if (!document || typeof document !== "object") throw new ClientError(`${url.href} is not a client metadata document.`);
    if (document["client_id"] !== url.href) throw new ClientError(`The client_id in ${url.href} is not that address.`);
    const client: Client = {
      id: url.href,
      name: nameOf(document["client_name"], url.hostname),
      redirectUris: redirectUrisOf(document["redirect_uris"]),
      verified: true,
    };

    if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(url.href, { client, until: Date.now() + CACHE_MS });
    return client;
  };

  return {
    /** The client behind an ID, or a ClientError that says why there is none. */
    async resolve(clientId: string): Promise<Client> {
      const url = documentUrl(clientId);
      if (url) return fromDocument(url);

      if (clientId.startsWith(REGISTERED_PREFIX)) {
        const json = unseal(key, clientId.slice(REGISTERED_PREFIX.length));
        if (json !== null) {
          const registered = JSON.parse(json) as { name: string; redirectUris: string[] };
          return { id: clientId, name: registered.name, redirectUris: registered.redirectUris, verified: false };
        }
      }
      throw new ClientError("Mica does not know this client.");
    },

    /** Dynamic registration (RFC 7591), with nothing stored: the client ID holds the registration. */
    register(metadata: Record<string, unknown>): Client {
      const redirectUris = redirectUrisOf(metadata["redirect_uris"]);
      const name = nameOf(metadata["client_name"], "An unnamed app");
      const id = `${REGISTERED_PREFIX}${seal(key, { name, redirectUris })}`;
      return { id, name, redirectUris, verified: false };
    },
  };
}

export type Clients = ReturnType<typeof createClients>;
