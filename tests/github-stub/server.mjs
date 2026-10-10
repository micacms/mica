/**
 * A stand-in for the GitHub REST API, for the test stacks — see README.md.
 *
 * It answers exactly the calls the GitHub connector makes, against an
 * in-memory repository seeded from a directory: the contents API for reads,
 * and the Git Data API (blobs, trees, commits, refs) for a publication. A ref
 * update that is not a fast-forward is refused, like GitHub refuses it.
 *
 * No dependencies. Not a general GitHub emulator, and not for anything but tests.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, relative, sep } from "node:path";

const PORT = Number(process.env.PORT ?? 8787);
const SEED_DIR = process.env.SEED_DIR ?? "/seed";
const SEED_ROOT = process.env.SEED_ROOT ?? "content";
const BRANCH = process.env.BRANCH ?? "main";

const sha1 = (data) => createHash("sha1").update(data).digest("hex");

/** Blob SHA the way Git computes it, so revisions are content-addressed. */
const blobSha = (bytes) => sha1(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));

const blobs = new Map(); // sha → Buffer
const trees = new Map(); // sha → Map(repo path → blob sha)
const commits = new Map(); // sha → { tree, parents, message, author }
const refs = new Map(); // branch → commit sha

function storeBlob(bytes) {
  const sha = blobSha(bytes);
  blobs.set(sha, bytes);
  return sha;
}

function storeTree(files) {
  const sha = sha1(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b))));
  trees.set(sha, files);
  return sha;
}

let commitCounter = 0;
function storeCommit(tree, parents, message, author = null) {
  const sha = sha1(`${tree}\n${parents.join(",")}\n${message}\n${commitCounter++}`);
  commits.set(sha, { tree, parents, message, author });
  return sha;
}

/* ---------------------------------------------------------------- seed */

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const seed = new Map();
for (const file of walk(SEED_DIR)) {
  const path = [SEED_ROOT, ...relative(SEED_DIR, file).split(sep)].filter(Boolean).join("/");
  seed.set(path, storeBlob(readFileSync(file)));
}
refs.set(BRANCH, storeCommit(storeTree(seed), [], "Seed"));

/* -------------------------------------------------------------- helpers */

const filesAt = (commitSha) => trees.get(commits.get(commitSha)?.tree);

function send(response, status, body, type = "application/json") {
  response.writeHead(status, { "content-type": type });
  response.end(type === "application/json" ? JSON.stringify(body) : body);
}

const notFound = (response) => send(response, 404, { message: "Not Found" });

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** The children of a directory, as the contents API lists them. */
function listDirectory(files, path) {
  const prefix = path ? `${path}/` : "";
  const children = new Map();
  for (const [file, sha] of files) {
    if (!file.startsWith(prefix)) continue;
    const [name, ...rest] = file.slice(prefix.length).split("/");
    const type = rest.length === 0 ? "file" : "dir";
    children.set(name, { name, path: `${prefix}${name}`, sha: type === "file" ? sha : sha1(name), type });
  }
  return [...children.values()];
}

/* -------------------------------------------------------------- routes */

async function handle(request, response) {
  const url = new URL(request.url, "http://stub");

  if (!request.headers.authorization?.startsWith("Bearer ")) {
    return send(response, 401, { message: "Requires authentication" });
  }

  const match = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/(.*)$/);
  if (!match) return notFound(response);
  const rest = match[1];

  // GET contents/{path}?ref= — a file (raw or JSON envelope) or a directory.
  if (request.method === "GET" && (rest === "contents" || rest.startsWith("contents/"))) {
    const path = decodeURIComponent(rest.slice("contents".length).replace(/^\//, ""));
    const files = filesAt(refs.get(url.searchParams.get("ref") ?? BRANCH));
    if (!files) return notFound(response);

    const sha = files.get(path);
    if (sha) {
      if ((request.headers.accept ?? "").includes("raw")) {
        return send(response, 200, blobs.get(sha), "application/octet-stream");
      }
      return send(response, 200, { name: path.split("/").pop(), path, sha, type: "file" });
    }

    const children = listDirectory(files, path);
    return children.length > 0 ? send(response, 200, children) : notFound(response);
  }

  // GET git/ref/heads/{branch}
  if (request.method === "GET" && rest.startsWith("git/ref/heads/")) {
    const sha = refs.get(decodeURIComponent(rest.slice("git/ref/heads/".length)));
    return sha ? send(response, 200, { object: { sha } }) : notFound(response);
  }

  // GET git/commits/{sha}
  if (request.method === "GET" && rest.startsWith("git/commits/")) {
    const sha = rest.slice("git/commits/".length);
    const commit = commits.get(sha);
    if (!commit) return notFound(response);
    return send(response, 200, {
      sha,
      message: commit.message,
      author: commit.author,
      tree: { sha: commit.tree },
      parents: commit.parents.map((parent) => ({ sha: parent })),
    });
  }

  // GET git/trees/{commit}[:{root}]?recursive=1 — paths relative to the root.
  if (request.method === "GET" && rest.startsWith("git/trees/")) {
    const target = decodeURIComponent(rest.slice("git/trees/".length));
    const [commitSha, root = ""] = target.split(":");
    const files = filesAt(commitSha);
    if (!files) return notFound(response);

    const prefix = root ? `${root}/` : "";
    const tree = [...files]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, sha]) => ({ path: path.slice(prefix.length), mode: "100644", type: "blob", sha }));
    if (root && tree.length === 0) return notFound(response);

    return send(response, 200, { sha: sha1(target), truncated: false, tree });
  }

  // POST git/blobs
  if (request.method === "POST" && rest === "git/blobs") {
    const { content, encoding } = await readJson(request);
    const bytes = Buffer.from(content, encoding === "base64" ? "base64" : "utf8");
    return send(response, 201, { sha: storeBlob(bytes) });
  }

  // POST git/trees — a base tree plus entries; a null SHA deletes the path.
  if (request.method === "POST" && rest === "git/trees") {
    const { base_tree: base, tree } = await readJson(request);
    const files = new Map(trees.get(base) ?? []);
    for (const entry of tree) {
      if (entry.sha === null) files.delete(entry.path);
      else if (blobs.has(entry.sha)) files.set(entry.path, entry.sha);
      else return send(response, 422, { message: `Unknown blob ${entry.sha}` });
    }
    return send(response, 201, { sha: storeTree(files) });
  }

  // POST git/commits
  if (request.method === "POST" && rest === "git/commits") {
    const { message, tree, parents, author } = await readJson(request);
    if (!trees.has(tree)) return send(response, 422, { message: `Unknown tree ${tree}` });
    return send(response, 201, { sha: storeCommit(tree, parents, message, author ?? null) });
  }

  // PATCH git/refs/heads/{branch} — a fast-forward only, unless forced.
  if (request.method === "PATCH" && rest.startsWith("git/refs/heads/")) {
    const branch = decodeURIComponent(rest.slice("git/refs/heads/".length));
    const { sha, force } = await readJson(request);
    const commit = commits.get(sha);
    if (!refs.has(branch) || !commit) return notFound(response);
    if (!force && !commit.parents.includes(refs.get(branch))) {
      return send(response, 422, { message: "Update is not a fast forward" });
    }
    refs.set(branch, sha);
    return send(response, 200, { object: { sha } });
  }

  return notFound(response);
}

createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(error);
    send(response, 500, { message: String(error) });
  });
}).listen(PORT, () => {
  console.log(`GitHub stub on :${PORT}, ${seed.size} files under ${SEED_ROOT}/ on ${BRANCH}`);
});
