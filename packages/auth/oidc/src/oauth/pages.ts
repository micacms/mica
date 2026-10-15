/**
 * The two pages a person sees when an agent asks for access: the consent page,
 * and the error page for a request that cannot go back to the agent. Plain
 * HTML, no script; every value is escaped.
 */

import { randomBytes } from "node:crypto";

import { SCOPE_WORDS } from "./scopes.js";

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The page, with its own policy: only its own inline style, never in a frame. */
function page(title: string, body: string): { html: string; csp: string } {
  const nonce = randomBytes(16).toString("base64");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Mica</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; --fg: #1f2421; --muted: #5f665f; --bg: #f7f5f0; --card: #fff; --line: #dedbd2; --accent: #2f5d50; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ecebe6; --muted: #a9ada6; --bg: #171a18; --card: #202421; --line: #353a36; --accent: #8cc2ae; } }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 32rem; margin: 3rem auto; padding: 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px; }
  h1 { font-size: 1.3rem; margin: 0 0 1rem; }
  p, ul { margin: 0 0 1rem; }
  .muted { color: var(--muted); font-size: .9rem; }
  .warn { border-left: 3px solid #c58b2a; padding-left: 12px; }
  code { font-size: .9em; overflow-wrap: anywhere; }
  .actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 1.5rem; }
  button { font: inherit; padding: 8px 18px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
  button[value="allow"] { background: var(--accent); border-color: var(--accent); color: var(--card); }
</style>
</head>
<body><main><div class="card">${body}</div></main></body>
</html>`;
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`;
  return { html, csp };
}

export interface ConsentView {
  site: string;
  email: string;
  clientName: string;
  /** Where the client's ID points, when it is an address. */
  clientHost: string | null;
  verified: boolean;
  redirectUri: string;
  scopes: string[];
  endsAt: Date;
  /** The sealed request and the session's CSRF token, for the form. */
  request: string;
  csrf: string;
  action: string;
}

export function consentPage(view: ConsentView): { html: string; csp: string } {
  const target = URL.canParse(view.redirectUri) ? new URL(view.redirectUri) : null;
  const returnTo = target ? (target.host ? `${target.protocol}//${target.host}` : target.protocol) : view.redirectUri;
  const who = view.verified
    ? `<p class="muted">Its address: <code>${escape(view.clientHost ?? "")}</code>. That site states this name.</p>`
    : `<p class="muted warn">This app registered itself. Mica cannot confirm its name.</p>`;
  const permissions = view.scopes.map((scope) => `<li>${escape(SCOPE_WORDS[scope] ?? scope)}</li>`).join("");
  const until = view.endsAt.toISOString().slice(0, 16).replace("T", " ");

  return page(
    "Allow access",
    `<h1>Allow ${escape(view.clientName)} to edit ${escape(view.site)}?</h1>
<p>You are signed in as <strong>${escape(view.email)}</strong>. The app acts as you. It can:</p>
<ul>${permissions}</ul>
${who}
<p class="muted">After you allow it, Mica sends you back to <code>${escape(returnTo)}</code>. The access ends at ${escape(until)} UTC.</p>
<p class="muted">Allow only an app that you started yourself.</p>
<form method="post" action="${escape(view.action)}">
<input type="hidden" name="request" value="${escape(view.request)}">
<input type="hidden" name="csrf" value="${escape(view.csrf)}">
<div class="actions"><button type="submit" name="decision" value="deny">Cancel</button><button type="submit" name="decision" value="allow">Allow</button></div>
</form>`,
  );
}

export function errorPage(message: string): { html: string; csp: string } {
  return page("Access not possible", `<h1>The app cannot get access</h1><p>${escape(message)}</p><p class="muted">Close this page, and try again from the app.</p>`);
}
