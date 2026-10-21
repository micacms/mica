/** The HTTP server of an app: the host name of what is beside it goes there, and an upgrade only when something is beside it. */

import assert from "node:assert/strict";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { Hono } from "hono";

import { createAppServer, type BesideTheApp } from "../src/server.js";
import type { Env } from "../src/http.js";

const app = new Hono<Env>();
app.get("/health", (c) => c.text("the app"));

/** Raw bytes to a server, and all that it answers until it closes. */
async function exchange(server: Server, lines: string): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await new Promise<string>((resolve) => {
      const socket = connect((server.address() as AddressInfo).port, "127.0.0.1", () => socket.write(lines));
      let received = "";
      socket.on("data", (data) => (received += data.toString()));
      socket.on("close", () => resolve(received));
      setTimeout(() => socket.end(), 500);
    });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const request = (host: string, upgrade = false) =>
  `GET /health HTTP/1.1\r\nhost: ${host}\r\n${upgrade ? "upgrade: h2c\r\nconnection: Upgrade\r\n" : "connection: close\r\n"}\r\n`;

describe("the app's server", () => {
  it("answers an upgrade request as a plain one when nothing is beside the app, as the local editor", async () => {
    assert.match(await exchange(createAppServer(app, "127.0.0.1"), request("localhost:6421", true)), /^HTTP\/1\.1 200[\s\S]*the app$/);
  });

  it("gives the host name of what is beside the app to it, requests and upgrades, and drops other upgrades", async () => {
    const seen: string[] = [];
    const beside: BesideTheApp = {
      handles: (incoming: IncomingMessage) => incoming.headers.host === "preview.cms.example.com",
      request: (_incoming: IncomingMessage, response: ServerResponse) => {
        seen.push("request");
        response.writeHead(200, { connection: "close" }).end("beside");
      },
      upgrade: (_incoming, socket) => {
        seen.push("upgrade");
        socket.end("HTTP/1.1 101 Switching Protocols\r\n\r\n");
      },
      close: () => {},
    };
    assert.match(await exchange(createAppServer(app, "127.0.0.1", beside), request("preview.cms.example.com")), /\r\nbeside\r\n/);
    assert.match(await exchange(createAppServer(app, "127.0.0.1", beside), request("cms.example.com")), /\r\n\r\nthe app$/);
    assert.match(await exchange(createAppServer(app, "127.0.0.1", beside), request("preview.cms.example.com", true)), /^HTTP\/1\.1 101/);
    assert.equal(await exchange(createAppServer(app, "127.0.0.1", beside), request("cms.example.com", true)), "");
    assert.deepEqual(seen, ["request", "upgrade"]);
  });
});
