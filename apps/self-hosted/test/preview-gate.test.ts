/** The gate of the self-hosted live preview: only the editor's browser gets to the dev server, and the website never sees Mica's cookie. */

import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { createLogger } from "@micacms/runtime";

import { createPreviewGate, type PreviewGate } from "../src/preview-gate.js";

const EDITOR = "https://cms.example.com";
const PREVIEW = "https://preview.cms.example.com";

describe("the preview gate", () => {
  let upstream: Server;
  let gate: PreviewGate;
  let address: string;
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
    address = `http://127.0.0.1:${await gate.listen("127.0.0.1", 0)}`;
  });

  after(() => {
    gate.close();
    upstream.close();
    upstream.closeAllConnections();
  });

  /** Posts a token from the editor, and gives the cookie that the gate answers with. */
  async function signIn(token: string, origin = EDITOR): Promise<Response> {
    return fetch(`${address}/__mica/session`, { method: "POST", headers: { origin }, body: token });
  }
  const cookieOf = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0]!;

  it("refuses a request without its cookie", async () => {
    assert.equal((await fetch(`${address}/services/`)).status, 401);
    assert.equal(seen, null);
  });

  it("gives a cookie of its own origin for the editor's token, and only for the editor's origin", async () => {
    const answer = await signIn(gate.handover("person-1"));
    assert.equal(answer.status, 204);
    assert.equal(answer.headers.get("access-control-allow-origin"), EDITOR);
    assert.equal(answer.headers.get("access-control-allow-credentials"), "true");
    assert.match(answer.headers.get("set-cookie") ?? "", /^__Host-mica_preview=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
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
    const mica = "__Host-mica_session=s; mica_csrf=c; __Secure-mica_oidc=o";
    const answer = await fetch(`${address}/services/?draft=1`, { headers: { cookie: `${cookie}; ${mica}; theme=dark` } });
    assert.equal(answer.status, 200);
    assert.equal(await answer.text(), "<h1>Services</h1>");
    assert.equal(answer.headers.get("x-frame-options"), null);
    assert.equal(answer.headers.get("content-security-policy"), `img-src 'self', frame-ancestors ${EDITOR}`);
    assert.equal(answer.headers.get("cache-control"), "private, no-store");
    assert.equal(seen?.url, "/services/?draft=1");
    assert.equal(seen?.headers.cookie, "theme=dark");
    assert.equal(seen?.headers.host, `localhost:${(upstream.address() as AddressInfo).port}`);
  });

  it("answers a request target that no URL parser takes, and keeps running", async () => {
    const { port } = new URL(address);
    const raw = (target: string) =>
      new Promise<string>((resolve) => {
        const socket = connect(Number(port), "127.0.0.1", () => socket.write(`GET ${target} HTTP/1.1\r\nhost: preview\r\nconnection: close\r\n\r\n`));
        let received = "";
        socket.on("data", (data) => (received += data.toString()));
        socket.on("close", () => resolve(received));
      });
    assert.match(await raw("/\\a:99999/"), /^HTTP\/1\.1 401/);
    assert.match(await raw("//a:99999/"), /^HTTP\/1\.1 401/);
    assert.equal((await fetch(`${address}/services/`)).status, 401, "the gate still answers");
  });

  it("passes the WebSocket of Vite's reload from the preview's pages with its cookie, and refuses it otherwise", async () => {
    const cookie = cookieOf(await signIn(gate.handover("person-1")));
    const { port } = new URL(address);
    const exchange = (headers: string, send?: string) =>
      new Promise<string>((resolve) => {
        const socket = connect(Number(port), "127.0.0.1", () =>
          socket.write(`GET /?token=vite HTTP/1.1\r\nhost: preview\r\nupgrade: websocket\r\nconnection: Upgrade\r\n${headers}\r\n`),
        );
        let received = "";
        socket.on("data", (data) => {
          received += data.toString();
          if (send && received.includes("\r\n\r\n") && !received.includes(send)) socket.write(send);
          if (!send || received.includes(send)) {
            socket.end();
            resolve(received);
          }
        });
        socket.on("end", () => resolve(received));
      });

    assert.match(await exchange(`origin: ${PREVIEW}\r\n`), /^HTTP\/1\.1 401/);
    // Another page of the same site cannot use the editor's cookie for it.
    assert.match(await exchange(`origin: https://www.example.com\r\ncookie: ${cookie}\r\n`), /^HTTP\/1\.1 401/);
    const answer = await exchange(`origin: ${PREVIEW}\r\ncookie: ${cookie}\r\n`, "ping");
    assert.match(answer, /^HTTP\/1\.1 101/);
    assert.match(answer, /ping$/);
    assert.equal(seen?.url, "/?token=vite");
    assert.equal(seen?.headers.cookie, undefined);
  });
});
