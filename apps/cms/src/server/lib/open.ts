/**
 * Opens a URL in whatever the desktop considers a browser.
 *
 * A courtesy, and treated as one: every failure is swallowed. A machine with no
 * desktop session — over SSH, in a container, in CI — has nothing to open, and
 * a server that refused to start because of it would be absurd.
 */

import { spawn } from "node:child_process";

export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? // The empty string is `start`'s window title. Without it, a quoted URL
          // is taken as the title and nothing opens.
          ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];

  try {
    const child = spawn(command!, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    // Detached and unreferenced, so a browser that outlives Mica does not keep
    // the Node process alive after Ctrl+C.
    child.unref();
  } catch {
    // There is no browser here. That is not an error.
  }
}
