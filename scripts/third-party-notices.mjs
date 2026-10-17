/**
 * Third-party license notices: one section per package, with its license text.
 *
 *   node scripts/third-party-notices.mjs <folder>   all packages under <folder>
 *
 * The image build runs it on the deploy folder; the editor UI's Vite build
 * calls `packageRoot` and `formatNotices` for the modules in its bundle.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// LICENSE, LICENSE.md, LICENSE-MIT, COPYING, NOTICE, MIT-LICENSE, …
const LICENSE_FILE = /^((licen[cs]e|copying|notice)([-._][\w.-]*)?|[\w.-]+-licen[cs]e(\.\w+)?)$/i;

/** The MIT text, for a package that declares MIT and ships no license file. */
const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** The ISC text, for a package that declares ISC and ships no license file. */
const ISC = (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

/** The folder of the npm package that holds `file`, or null outside node_modules. */
export function packageRoot(file) {
  const parts = file.split(/[\\/]/);
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return null;
  const length = parts[index + 1].startsWith("@") ? index + 3 : index + 2;
  return parts.slice(0, length).join("/");
}

/** Name, version, license and license texts of the package in `folder`. */
export function readPackage(folder) {
  const manifest = path.join(folder, "package.json");
  if (!existsSync(manifest)) return null;
  const { name, version, license, author } = JSON.parse(readFileSync(manifest, "utf8"));
  if (!name || !version) return null;
  const texts = readdirSync(folder)
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
    .map((file) => readFileSync(path.join(folder, file), "utf8").trim());
  // npm requires no license file; MIT and ISC require their text with the notice.
  const template = { MIT, ISC }[license];
  if (texts.length === 0 && template) {
    const holder = typeof author === "string" ? author : (author?.name ?? `the authors of ${name}`);
    texts.push(`(No license file in the package; the ${license} text, with the author from its package.json.)\n\n${template(holder)}`);
  }
  return { name, version, license: typeof license === "string" ? license : "see the license text", texts };
}

/** The folders of the runtime dependencies of the package in `folder`, transitively, found as Node finds them. */
export function dependencyRoots(folder) {
  const found = new Set();
  const visit = (from) => {
    const { dependencies = {} } = JSON.parse(readFileSync(path.join(from, "package.json"), "utf8"));
    for (const name of Object.keys(dependencies)) {
      for (let dir = realpathSync(from); ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, "node_modules", name);
        if (existsSync(path.join(candidate, "package.json"))) {
          const root = realpathSync(candidate);
          if (!found.has(root)) {
            found.add(root);
            visit(root);
          }
          break;
        }
        if (path.dirname(dir) === dir) break;
      }
    }
  };
  visit(folder);
  return [...found];
}

/** The notices file for a set of packages, without Mica's own. */
export function formatNotices(packages, intro = "") {
  const unique = new Map();
  for (const item of packages) {
    if (item && !item.name.startsWith("@micacms/")) unique.set(`${item.name}@${item.version}`, item);
  }
  const sections = [...unique.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map((item) => {
      const body = item.texts.length > 0 ? item.texts.join("\n\n") : `License: ${item.license}. The package ships no license file.`;
      return `${"-".repeat(78)}\n${item.name}@${item.version} (${item.license})\n${"-".repeat(78)}\n\n${body}\n`;
    });
  return `${intro}This product includes the following third-party software.\n\n${sections.join("\n")}`;
}

/** Every package folder below `root`, symbolic links not followed. */
function packageFolders(root) {
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(folder, entry.name);
      if (path.basename(folder) === "node_modules" || path.basename(path.dirname(folder)) === "node_modules") {
        if (!entry.name.startsWith("@") && existsSync(path.join(child, "package.json"))) found.push(child);
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2];
  if (!root || !statSync(root).isDirectory()) {
    process.stderr.write("Usage: node scripts/third-party-notices.mjs <folder>\n");
    process.exit(64);
  }
  process.stdout.write(formatNotices(packageFolders(root).map(readPackage)));
}
