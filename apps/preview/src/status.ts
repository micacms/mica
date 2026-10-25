/**
 * What the preview tells Mica about itself (ADR 40): its state, a reason, and
 * its last lines of output, on `GET /status` at port 4380 inside the network.
 * Mica reads it on the server side and shows it to signed-in editors; the
 * preview publishes no port, and Mica's gate never forwards to this one.
 */

import { createServer, type Server } from "node:http";

export const STATUS_PORT = 4380;
const LINES_KEPT = 50;
const LINE_MAX = 500;

export type PreviewStep = "waiting" | "copying" | "installing" | "starting" | "running" | "failed";

export interface PreviewReport {
  state: PreviewStep;
  /** Since when, as an ISO time. */
  since: string;
  /** The commit of the clone that the copy has, or null before the first copy. */
  commit: string | null;
  reason: string | null;
  /** The last lines of output, the oldest first. */
  lines: string[];
}

// ESC and CSI sequences: colours and cursor moves of the install and of astro dev.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-_]/g;

/** Takes out what a line must not show: credentials in an address, and tokens. */
export function redactLine(text: string): string {
  return text
    .replace(ANSI, "")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1***@")
    .replace(/(_authToken|_auth|_password|token|password)(\s*[=:]\s*)\S+/gi, "$1$2***")
    .replace(/\b(Bearer|Basic)\s+\S+/g, "$1 ***")
    .replace(/\b(npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g, "***");
}

export function createStatusBoard(now: () => Date = () => new Date()) {
  let report: Omit<PreviewReport, "lines"> = { state: "waiting", since: now().toISOString(), commit: null, reason: null };
  const lines: string[] = [];
  /** The end of a line that a chunk of output cut in two. */
  const partial = new Map<string, string>();

  const push = (line: string) => {
    const clean = redactLine(line).trimEnd();
    if (!clean) return;
    lines.push(clean.length > LINE_MAX ? `${clean.slice(0, LINE_MAX - 1)}…` : clean);
    if (lines.length > LINES_KEPT) lines.shift();
  };

  return {
    /** Moves to a step. A step that stays keeps its time, so that "since" says how long it takes. */
    set(state: PreviewStep, reason: string | null = null): void {
      if (state !== report.state) report = { ...report, state, since: now().toISOString() };
      report.reason = reason;
    },
    commit(commit: string | null): void {
      report.commit = commit;
    },
    line: push,
    /** Output of a process, in chunks that can cut a line: each source keeps its own unfinished line. */
    output(source: string, chunk: string): void {
      const text = (partial.get(source) ?? "") + chunk;
      const parts = text.split(/\r?\n/);
      partial.set(source, parts.pop() ?? "");
      for (const part of parts) push(part);
    },
    report: (): PreviewReport => ({ ...report, lines: [...lines] }),
  };
}

export type StatusBoard = ReturnType<typeof createStatusBoard>;

/** Answers `GET /status`, and nothing else. */
export function serveStatus(board: StatusBoard, port = STATUS_PORT): Server {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/status") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(board.report()));
  });
  server.listen(port, "0.0.0.0");
  return server;
}
