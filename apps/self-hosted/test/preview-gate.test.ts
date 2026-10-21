/** The gate of the self-hosted live preview: only the editor's browser gets to the dev server, and the website never sees Mica's cookies. */

import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { createAppServer, createLogger, type Env } from "@micacms/runtime";
import { Hono } from "hono";

import { createPreviewGate, type PreviewGate } from "../src/preview-gate.js";

const EDITOR = "https://cms.example.com";
const PREVIEW = "https://preview.cms.example.com";
const PREVIEW_HOST = "preview.cms.example.com";

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

describe("the preview gate", () => {
  let upstream: Server;
  let gate: PreviewGate;
  /** Mica's port, served by the runtime: the preview's host name to the gate, everything else to the editor. */
  let mica: Server;
  let port: number;
  /** What the dev server got last. */
  let seen: { url: string; headers: IncomingHttpHeaders } | null = null;

  before(async () => {
    upstream = createServer((request, response) => {
      seen = { url: request.url ?? "", headers: request.headers };
      response.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY", "content-security-policy": "img-src 'self'" });
      response.end("<h1>Services</h1>");
    });
    // Vite's reload: a WebSocket that echoes, enough to see the bytes go both ways.
    upstream.on("upgrade", (request, socket) => {
      seen = { url: request.url ?? "", headers: request.headers };
      socket.write("HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n");
      socket.on("data", (data) => socket.write(data));
      socket.on("end", () => socket.end());
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    gate = createPreviewGate({
      editorOrigin: EDITOR,
      previewOrigin: PREVIEW,
      upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      secret: "0".repeat(32),
      logger: createLogger({ level: "silent", pretty: false }),
    });
    const editor = new Hono<Env>();
    editor.all("*", (c) => c.text("the editor"));
    mica = createAppServer(editor, "127.0.0.1", gate);
    await new Promise<void>((resolve) => mica.listen(0, "127.0.0.1", resolve));
    port = (mica.address() as AddressInfo).port;
  });

  after(() => {
    gate.close();
    mica.close();
    mica.closeAllConnections();
    upstream.close();
    upstream.closeAllConnections();
  });

  /** A request to Mica's port, by default for the preview's host name, as the browser sends it through the proxy. */
  function send(path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Answer> {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        { host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: { host: PREVIEW_HOST, ...options.headers } },
        (answer) => {
          let text = "";
          answer.on("data", (chunk: Buffer) => (text += chunk.toString()));
          answer.on("end", () => resolve({ status: answer.statusCode ?? 0, headers: answer.headers, text }));
        },
      );
      outgoing.on("error", reject);
      outgoing.end(options.body);
    });
  }

  /** Posts a token from the editor's origin. */
  const signIn = (token: string, origin = EDITOR) => send("/__mica/session", { method: "POST", headers: { origin }, body: token });
  const cookieOf = (answer: Answer) => (answer.headers["set-cookie"]?.[0] ?? "").split(";")[0]!;

  it("takes only its host name, also with a port or a final dot, and refuses a request without its cookie", async () => {
    assert.equal((await send("/services/", { headers: { host: "cms.example.com" } })).text, "the editor");
    assert.equal((await send("/services/", { headers: { host: "cms.example.com." } })).text, "the editor");
    for (const host of [PREVIEW_HOST, "PREVIEW.cms.example.com:443", `${PREVIEW_HOST}.`]) {
      assert.equal((await send("/services/", { headers: { host } })).status, 401, host);
    }
    assert.equal(seen, null);
  });

  it("gives a cookie of its own origin for the editor's token, and only for the editor's origin", async () => {
    const answer = await signIn(gate.handover("person-1"));
    assert.equal(answer.status, 204);
    assert.equal(answer.headers["access-control-allow-origin"], EDITOR);
    assert.equal(answer.headers["access-control-allow-credentials"], "true");
    assert.match(answer.headers["set-cookie"]?.[0] ?? "", /^__Host-mica_preview=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
    assert.equal((await signIn(gate.handover("person-1"), "https://evil.example.com")).status, 403);
  });

  it("refuses a forged token, and a cookie offered as a token", async () => {
    const token = gate.handover("person-1");
    assert.equal((await signIn(`${token.split(".")[0]}.AAAA`)).status, 401);
    const cookie = cookieOf(await signIn(token)).slice("__Host-mica_preview=".length);
    assert.equal((await signIn(cookie)).status, 401);
  });

  it("forwards to the dev server without Mica's cookies, to a host that Vite answers, and lets only the editor frame the page", async () => {
    const cookie = cookieOf(await signIn(gate.handover("person-1")));
    const micaCookies = "__Host-mica_session=s; mica_csrf=c; __Secure-mica_oidc=o";
    const answer = await send("/services/?draft=1", { headers: { cookie: `${cookie}; ${micaCookies}; theme=dark` } });
    assert.equal(answer.status, 200);
    assert.equal(answer.text, "<h1>Services</h1>");
    assert.equal(answer.headers["x-frame-options"], undefined);
    assert.equal(answer.headers["content-security-policy"], `img-src 'self', frame-ancestors ${EDITOR}`);
    assert.equal(answer.headers["cache-control"], "private, no-store");
    assert.equal(seen?.url, "/services/?draft=1");
    assert.equal(seen?.headers.cookie, "theme=dark");
    assert.equal(seen?.headers.host, `localhost:${(upstream.address() as AddressInfo).port}`);
  });

  /** Raw bytes to Mica's port, for what a client library would refuse to send. */
  const raw = (lines: string, reply?: string) =>
    new Promise<string>((resolve) => {
      const socket = connect(port, "127.0.0.1", () => socket.write(lines));
      let received = "";
      socket.on("data", (data) => {
        received += data.toString();
        if (reply && received.includes("\r\n\r\n") && !received.includes(reply)) socket.write(reply);
        if (reply && received.includes(reply)) socket.end();
      });
      socket.on("close", () => resolve(received));
    });

  it("answers a request target that no URL parser takes, and keeps running", async () => {
    for (const target of ["/\\a:99999/", "//a:99999/"]) {
      assert.match(await raw(`GET ${target} HTTP/1.1\r\nhost: ${PREVIEW_HOST}\r\nconnection: close\r\n\r\n`), /^HTTP\/1\.1 401/, target);
    }
    assert.equal((await send("/services/")).status, 401, "the gate still answers");
  });

  it("survives a client that resets a refused WebSocket, and drops the upgrades of the editor's name", async () => {
    const reset = connect(port, "127.0.0.1", () => {
      reset.write(`GET / HTTP/1.1\r\nhost: ${PREVIEW_HOST}\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n`);
      reset.resetAndDestroy();
    });
    await new Promise((resolve) => reset.on("close", resolve));
    assert.equal(await raw(`GET / HTTP/1.1\r\nhost: cms.example.com\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n`), "");
    assert.equal((await send("/services/")).status, 401, "the gate still answers");
  });

  it("passes the WebSocket of Vite's reload from the preview's pages with its cookie, and refuses it otherwise", async () => {
    const cookie = cookieOf(await signIn(gate.handover("person-1")));
    const upgrade = (headers: string) => `GET /?token=vite HTTP/1.1\r\nhost: ${PREVIEW_HOST}\r\nupgrade: websocket\r\nconnection: Upgrade\r\n${headers}\r\n`;

    assert.match(await raw(upgrade(`origin: ${PREVIEW}\r\n`)), /^HTTP\/1\.1 401/);
    // Another page of the same site cannot use the editor's cookie for it.
    assert.match(await raw(upgrade(`origin: https://www.example.com\r\ncookie: ${cookie}\r\n`)), /^HTTP\/1\.1 401/);
    const answer = await raw(upgrade(`origin: ${PREVIEW}\r\ncookie: ${cookie}\r\n`), "ping");
    assert.match(answer, /^HTTP\/1\.1 101/);
    assert.match(answer, /ping$/);
    assert.equal(seen?.url, "/?token=vite");
    assert.equal(seen?.headers.cookie, undefined);
  });
});
