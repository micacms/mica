/**
 * What `npx @micacms/cms` says when it works.
 *
 * The startup log lines are written for whoever is reading a container's
 * output later: every field that could matter, flat, greppable, and in no
 * particular order of importance. A person who has just typed a command needs
 * the opposite — the address to open, the directory being edited, and what
 * pressing Save will do to their repository. Three facts, in that order,
 * because the first minute decides whether there is a second one.
 *
 * Everything here is decoration over information the server already has. It is
 * printed instead of the startup log lines, never as well: two accounts of the
 * same event, disagreeing in tone, is worse than either alone.
 */

import path from "node:path";

export interface Banner {
  version: string;
  /** The origin the person should open, without the `/admin/` path. */
  url: string;
  contentRoot: string;
  collections: number;
  singletons: number;
  /** Where accounts and sessions go — outside the project, and worth saying. */
  dataDir: string;
  /** False when the repository is reached through GitHub or GitLab instead. */
  writesToWorkingTree: boolean;
}

/** ANSI, or nothing at all when the output is not a terminal. */
export function colors(enabled: boolean) {
  const wrap = (code: string) => (text: string) => (enabled ? `[${code}m${text}[0m` : text);
  return {
    bold: wrap("1"),
    dim: wrap("2"),
    brand: wrap("36"),
    label: wrap("2"),
  };
}

/**
 * True unless something says otherwise.
 *
 * `NO_COLOR` is the convention (no-color.org); a pipe or a file is the other
 * case, and escape codes in a redirected log help nobody.
 */
export function supportsColor(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  if (env["NO_COLOR"]) return false;
  if (env["FORCE_COLOR"]) return true;
  return Boolean(stream.isTTY);
}

/** Paths inside the working directory read better as the relative ones. */
function readable(target: string, cwd = process.cwd()): string {
  const relative = path.relative(cwd, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return target;
  return `./${relative}`;
}

/** "3 collections and 2 singletons", or whichever half is not zero. */
function modelSummary(collections: number, singletons: number): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (collections > 0) parts.push(plural(collections, "collection"));
  if (singletons > 0) parts.push(plural(singletons, "singleton"));
  return parts.join(" and ") || "an empty model";
}

export function startupBanner(banner: Banner, useColor: boolean): string {
  const c = colors(useColor);
  const editor = `${banner.url}/admin/`;

  const row = (label: string, value: string): string =>
    `  ${c.label(label.padEnd(9))}  ${value}`;

  const lines = [
    "",
    `  ${c.brand("◆")} ${c.bold("Mica")} ${c.dim(banner.version)}`,
    "",
    row("Editor", c.bold(editor)),
    row("Content", `${readable(banner.contentRoot)} ${c.dim(`— ${modelSummary(banner.collections, banner.singletons)}`)}`),
    row(
      "Saving",
      banner.writesToWorkingTree
        ? c.dim("writes files into that directory. Commit them like any other change.")
        : c.dim("commits to the content repository."),
    ),
    "",
    `  ${c.dim("No sign-in on your own machine — the link above opens straight into the editor.")}`,
    `  ${c.dim(`Accounts and sessions stay out of your project, in ${banner.dataDir}.`)}`,
    "",
    `  ${c.dim("Run your site's dev server beside this to see the changes. Ctrl+C stops Mica.")}`,
    "",
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * The one failure this command is most likely to hit, and the one the operating
 * system explains worst: `EADDRINUSE` alone tells nobody which port or what to
 * do instead.
 */
export function portInUse(port: number, host: string, useColor: boolean): string {
  const c = colors(useColor);
  return (
    `\n  ${c.bold(`Port ${port} is already in use on ${host}.`)}\n\n` +
    `  Something else is listening there — another Mica, most likely.\n` +
    `  Stop it, or give this one a different port:\n\n` +
    `    npx @micacms/cms --port ${port + 1}\n\n`
  );
}
