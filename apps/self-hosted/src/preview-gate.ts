/**
 * The live preview of the self-hosted Mica (ADR 38): a gate on an origin of its
 * own in front of the website's `MICA_PREVIEW=1 astro dev`, which runs in
 * another container on the clone's content. The website's scripts run on that
 * origin, so they never get the editor's cookies or its API.
 *
 * The editor's browser comes in with a short token from `/api/admin/preview`,
 * which it posts to `/__mica/session`; the gate answers with a cookie of its own
 * origin. Every other request needs that cookie and goes to the dev server: the
 * plain requests, and the WebSocket of Vite's reload, which closes when the
 * cookie that opened it expires.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { pipeline, type Duplex } from "node:stream";

import type { Logger } from "@micacms/runtime";

const SESSION_PATH = "/__mica/session";
const HANDOVER_MS = 60_000;
const COOKIE_MS = 10 * 60_000;
/** Mica's own cookies, also with a `__Host-` or `__Secure-` prefix: the website must never get them. */
const MICA_COOKIE = /^(?:__Host-|__Secure-)?mica_/;

export interface PreviewGateOptions {
  /** The editor's origin: the only one that may hand over a token and frame the preview. */
  editorOrigin: string;
  /** The preview's public origin, such as `https://preview.cms.example.com`, on another host than the editor. */
  previewOrigin: string;
  /** The dev server inside the network, such as `http://preview:4321`. */
  upstream: string;
  /** MICA_SESSION_SECRET: the gate derives a key of its own from it. */
  secret: string;
  logger: Logger;
}

export interface PreviewGate {
  /** A token for the person of an editor's request, valid for one minute. */
  handover(person: string): string;
  /** Listens, and gives the port: the one asked for, or a free one for 0. */
  listen(host: string, port: number): Promise<number>;
  close(): void;
}

interface Pass {
  person: string;
  expires: number;
}

export function createPreviewGate(options: PreviewGateOptions): PreviewGate {
  const key = createHmac("sha256", options.secret).update("mica preview gate v1").digest();
  const upstream = new URL(options.upstream);
  const port = Number(upstream.port || 80);
  // Vite answers only `localhost` and addresses, against DNS rebinding. Only the gate reaches the dev server.
  const host = `localhost:${port}`;
  const secure = options.previewOrigin.startsWith("https:");
  // On https, `__Host-`: no other host of the site can set a cookie of that name for this one.
  const cookieName = secure ? "__Host-mica_preview" : "mica_preview";
  const mac = (body: string) => createHmac("sha256", key).update(body).digest();

  const sign = (kind: "handover" | "cookie", person: string, ms: number): string => {
    const body = Buffer.from(JSON.stringify({ k: kind, p: person, x: Date.now() + ms })).toString("base64url");
    return `${body}.${mac(body).toString("base64url")}`;
  };
  /** The pass of a valid token of that kind, or null. */
  const verify = (kind: "handover" | "cookie", token: string | undefined): Pass | null => {
    const [body, signature, extra] = (token ?? "").split(".");
    if (!body || !signature || extra !== undefined) return null;
    const given = Buffer.from(signature, "base64url");
    const expected = mac(body);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const value = JSON.parse(Buffer.from(body, "base64url").toString()) as { k?: unknown; p?: unknown; x?: unknown };
      const valid = value.k === kind && typeof value.p === "string" && value.p !== "" && typeof value.x === "number" && value.x > Date.now();
      return valid ? { person: value.p as string, expires: value.x as number } : null;
    } catch {
      return null;
    }
  };
  const passOf = (request: IncomingMessage) => verify("cookie", cookies(request).get(cookieName));

  const cors = { "access-control-allow-origin": options.editorOrigin, "access-control-allow-credentials": "true", vary: "origin" };

  /** A token from the editor's origin becomes this origin's cookie. */
  const session = (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.origin !== options.editorOrigin) return end(response, 403, "Only the editor can sign in here.");
    if (request.method === "OPTIONS") return end(response, 204, "", { ...cors, "access-control-allow-methods": "POST" });
    if (request.method !== "POST") return end(response, 405, "", cors);
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 4096) request.destroy();
    });
    request.on("end", () => {
      const pass = verify("handover", body.trim());
      if (!pass) return end(response, 401, "The sign-in for the preview expired. Open the form again.", cors);
      const cookie = [`${cookieName}=${sign("cookie", pass.person, COOKIE_MS)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${COOKIE_MS / 1000}`];
      end(response, 204, "", { ...cors, "set-cookie": (secure ? [...cookie, "Secure"] : cookie).join("; ") });
    });
  };

  /** To the dev server, without Mica's cookies; only the editor can frame the answer. */
  const forward = (request: IncomingMessage, response: ServerResponse) => {
    if (!passOf(request)) return end(response, 401, "Open the preview from the editor.");
    const outgoing = httpRequest(
      { hostname: upstream.hostname, port, method: request.method, path: request.url, headers: upstreamHeaders(request, host) },
      (answer) => {
        const headers: Record<string, string | string[] | undefined> = { ...answer.headers };
        delete headers["x-frame-options"];
        // A second policy: the browser applies the website's own and this one.
        const own = answer.headers["content-security-policy"];
        headers["content-security-policy"] = [...(own === undefined ? [] : [own].flat()), `frame-ancestors ${options.editorOrigin}`];
        headers["cache-control"] = "private, no-store";
        response.writeHead(answer.statusCode ?? 502, headers);
        // Either side that stops ends the other: no connection to the dev server stays open.
        pipeline(answer, response, () => {});
      },
    );
    outgoing.on("error", (error) => {
      // The browser left: that is no fault of the dev server.
      if (response.destroyed || response.writableEnded) return;
      options.logger.warn("The preview's dev server does not answer", { upstream: options.upstream, error: error.message });
      if (!response.headersSent) end(response, 502, "The preview's dev server does not answer.");
      else response.destroy();
    });
    response.on("close", () => outgoing.destroy());
    pipeline(request, outgoing, () => {});
  };

  const server = createServer((request, response) => {
    // A request target that Node takes but a URL parser refuses must not stop Mica: no parse here, and each error stays with its request.
    try {
      if ((request.url ?? "").split("?")[0] === SESSION_PATH) session(request, response);
      else forward(request, response);
    } catch (error) {
      options.logger.debug("The preview's gate refused a request", { error: (error as Error).message });
      if (!response.headersSent) end(response, 400, "Bad request.");
      else response.destroy();
    }
  });

  const upgraded = new Set<Duplex>();
  // Vite's reload comes over a WebSocket: from the preview's own pages, with the cookie, until the cookie expires.
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pass = passOf(request);
    if (!pass || request.headers.origin !== options.previewOrigin) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
      return;
    }
    upgraded.add(socket);
    const expiry = setTimeout(() => socket.destroy(), pass.expires - Date.now());
    const target = connect(port, upstream.hostname, () => {
      const lines = Object.entries(upstreamHeaders(request, host)).flatMap(([name, value]) =>
        (Array.isArray(value) ? value : [value]).map((one) => `${name}: ${one}`),
      );
      target.write(`${request.method} ${request.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      target.write(head);
      target.pipe(socket).pipe(target);
    });
    // When one side closes, the other goes too: no socket stays half open.
    target.on("error", () => socket.destroy());
    socket.on("error", () => target.destroy());
    target.on("close", () => socket.destroy());
    socket.on("close", () => {
      clearTimeout(expiry);
      upgraded.delete(socket);
      target.destroy();
    });
  });

  return {
    handover: (person) => sign("handover", person, HANDOVER_MS),
    listen: (address, listenPort) =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, address, () => {
          const bound = (server.address() as AddressInfo).port;
          options.logger.info("Preview gate listening", { listening: `${address}:${bound}`, url: options.previewOrigin });
          resolve(bound);
        });
      }),
    close() {
      server.close();
      server.closeAllConnections();
      for (const socket of upgraded) socket.destroy();
    },
  };
}

function cookies(request: IncomingMessage): Map<string, string> {
  return new Map(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.includes("="))
      .map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]),
  );
}

/** The request's headers for the dev server: a host that it answers, and none of Mica's cookies, which the website must not see. */
function upstreamHeaders(request: IncomingMessage, host: string): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(request.headers)) if (value !== undefined && name !== "cookie" && name !== "host") headers[name] = value;
  headers["host"] = host;
  const others = [...cookies(request)].filter(([name]) => !MICA_COOKIE.test(name)).map(([name, value]) => `${name}=${value}`);
  if (others.length > 0) headers["cookie"] = others.join("; ");
  return headers;
}

function end(response: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  response.end(text);
}
