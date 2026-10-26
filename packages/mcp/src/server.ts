/**
 * The Mica tools, on the runtime's services. One definition for every
 * transport: stdio in `mica mcp`, and `/mcp` over HTTP in the local editor and
 * the image. A tool knows nothing of the transport or of how the caller
 * authenticated; a gate in front of `/mcp` decides that.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { compareEntries, entryFolder, entryTitle, MEDIA_FILE_TYPE_NAMES, readReferenceIndex, type AccessContext, type MediaAccept, type MediaFileType } from "@micacms/core/internal";
import { AGENT_SCOPES, ApiError, apiErrorOf, ConflictError, publishChanges, refuseWhileModelUnreadable, storeUpload, VERSION, type RuntimeContext } from "@micacms/runtime";
import { McpServer, type CallToolResult, type ScopeChallengeHandler } from "@modelcontextprotocol/server";
import { z } from "zod";

import { describeModel } from "./model.js";

/** The OAuth scopes a self-hosted Mica grants an agent. A local agent has no token and needs none. */
export const SCOPES = AGENT_SCOPES;

export interface McpOptions {
  /** Offer `publish`. Without it, an agent saves drafts and a person publishes them. */
  publish: boolean;
  /** `upload_media` can read a file on this machine by its path. Only where the agent runs on Mica's machine. */
  localFiles: boolean;
}

/** Who calls: the person behind the agent, when a gate knows one, and the agent's own name. */
export interface Caller {
  identity: AccessContext["identity"];
  clientName?: string;
}

const INSTRUCTIONS = `Mica edits the content of an Astro website. The content is files in a Git repository.

Start with describe_model: it gives the collections, the singletons, their fields and the format of each value.
A save writes a draft. The website changes only when the drafts are published. A person usually publishes them in the Mica editor.
Every read gives a revision. Send it back with the next save of the same entry, so that you never overwrite work that somebody saved since. On a conflict, read the entry again and apply your change to the new version.
A save replaces all the data of an entry: read it first, change what you must, and send all of it back.`;

/**
 * Asks for `scope` when the token lacks it, together with the scopes it has, so
 * that a client which asks for exactly the challenged scopes keeps them. Without
 * a token (local), there is nothing to check.
 */
const needs =
  (scope: string): ScopeChallengeHandler =>
  ({ authInfo }) => {
    if (!authInfo || authInfo.scopes.includes(scope)) return undefined;
    return { scopes: [...new Set([...authInfo.scopes, scope])] as [string, ...string[]] };
  };

/** A tool's answer, as JSON text. */
const ok = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

const refused = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

/**
 * A failure the agent can act on is a tool result it reads, not a protocol
 * error, with the mapping of the admin API. Anything else is a bug and is logged.
 */
function failure(ctx: RuntimeContext, error: unknown): CallToolResult {
  if (error instanceof ConflictError) return refused(`${error.message} Read it again, then retry with the new revision.`);
  const known = apiErrorOf(error);
  if (known) {
    // The operator must see a full or read-only disk in the log, as for the editor's own requests.
    if (known.code === "storage_unavailable") ctx.logger.error("Storage failure in an MCP tool", { error: String(error) });
    const details = { ...(known.issues ? { issues: known.issues } : {}), ...(known.path !== undefined ? { path: known.path } : {}) };
    return refused(Object.keys(details).length > 0 ? `${known.message}\n${JSON.stringify(details)}` : known.message);
  }
  ctx.logger.error("An MCP tool failed", { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  return refused("Something went wrong in Mica. The error is in Mica's log.");
}

/** The commit's author: the person. Without one, the commit keeps the developer's own Git identity. */
function author(caller: Caller) {
  const identity = caller.identity;
  return identity ? { name: identity.name || identity.email, email: identity.email } : undefined;
}

/** Who did it, for the log: the person, and the agent they let do it. */
function editor(caller: Caller): string {
  const who = caller.identity ? caller.identity.email || caller.identity.subject : "the developer";
  return `${who} via ${caller.clientName ?? "an MCP client"}`;
}

/** The body of an upload: the bytes the agent sent, or a file on this machine. */
async function uploadBody(
  input: { content?: string | undefined; file?: string | undefined },
  options: McpOptions,
): Promise<{ body: ReadableStream<Uint8Array>; size: number; close?: () => void }> {
  if (input.file !== undefined) {
    if (!options.localFiles) throw new ApiError("bad_request", "This Mica cannot read files on your machine. Send the file as base64 in `content`.");
    const file = path.resolve(input.file);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new ApiError("bad_request", `There is no file at ${file}.`);
    const stream = createReadStream(file);
    return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size: info.size, close: () => stream.destroy() };
  }
  if (input.content === undefined) throw new ApiError("bad_request", "Send the file as base64 in `content`, or its path in `file`.");
  const bytes = Buffer.from(input.content, "base64");
  return { body: new Blob([bytes]).stream(), size: bytes.length };
}

const uploadInput = z.object({
  name: z.string().describe("The file name, such as team-photo.jpg."),
  directory: z.string().optional().describe("An entry's media folder, such as projects/haus-a/media. Absent: the shared media folder."),
  content: z.string().optional().describe("The file's bytes, base64-encoded."),
  file: z.string().optional().describe("The path of the file on this machine."),
  accept: z
    .union([z.enum(["image", "document", "any"]), z.array(z.enum(MEDIA_FILE_TYPE_NAMES as [MediaFileType, ...MediaFileType[]])).min(1)])
    .optional()
    .describe("The `accept` of the media field it is for, as `describe_model` gives it."),
});

/** A new server with the Mica tools, for one request or one stdio connection. */
export function createMcpServer(ctx: RuntimeContext, options: McpOptions, caller: Caller = { identity: null }): McpServer {
  const server = new McpServer({ name: "mica", title: "Mica", version: VERSION }, { instructions: INSTRUCTIONS });

  /** Runs a tool on the newest model, and turns a failure into a result the agent reads. */
  const run =
    <A>(tool: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        // A model pushed or written since is used at once, as in the editor.
        await ctx.refreshModel();
        return ok(await tool(args));
      } catch (error) {
        return failure(ctx, error);
      }
    };

  /** Runs a tool that writes: refused while a newer content model cannot be read, as in the editor. */
  const runWrite = <A>(tool: (args: A) => Promise<unknown>) =>
    run(async (args: A) => {
      refuseWhileModelUnreadable(ctx);
      return tool(args);
    });

  const read = { scopeChallenge: needs(SCOPES.read), annotations: { readOnlyHint: true } };
  const write = { scopeChallenge: needs(SCOPES.write) };
  const content = () => ctx.services.content;

  server.registerTool(
    "describe_model",
    {
      title: "Describe the content model",
      description: "The collections and singletons of the website, their fields, and the format of each field's value. Read it before you write.",
      inputSchema: z.object({}),
      ...read,
    },
    run(async () => describeModel(ctx.site.model, ctx.site.readOnly)),
  );

  server.registerTool(
    "list_entries",
    {
      title: "List entries",
      description:
        "The entries of a collection, in the website's order: ID and title. `search` finds a text in any field. `orderRevision` is for reorder_entries.",
      inputSchema: z.object({
        collection: z.string().describe("The collection's name, from describe_model."),
        search: z.string().optional().describe("Only entries that contain this text."),
      }),
      ...read,
    },
    run(async ({ collection, search }: { collection: string; search?: string | undefined }) => {
      const def = content().requireCollection(collection);
      // Before the list: the revision is never newer than the order the agent sees.
      const orderRevision = await content().orderRevision(collection);
      const needle = search?.trim().toLowerCase();
      const entries = (await content().list(collection))
        .filter((entry) => !needle || JSON.stringify(entry.data).toLowerCase().includes(needle))
        .map((entry) => ({ id: entry.id, position: entry.position, title: entryTitle(def, entry.data), data: entry.data }))
        .sort(compareEntries(def));
      return { entries: entries.map(({ id, title }) => ({ id, title })), orderRevision };
    }),
  );

  server.registerTool(
    "get_entry",
    {
      title: "Read an entry",
      description: "All data of one entry, and its revision for the next save.",
      inputSchema: z.object({ collection: z.string(), id: z.string() }),
      ...read,
    },
    run(async ({ collection, id }: { collection: string; id: string }) => {
      const def = content().requireCollection(collection);
      // Before the data: a save in between then fails the next save's check, instead of being overwritten.
      const revision = await content().revisionOf(collection, id);
      const entry = await content().get(collection, id);
      if (!entry) throw new ApiError("not_found", `There is no entry "${id}" in "${collection}".`);
      return {
        collection,
        id: entry.id,
        title: entryTitle(def, entry.data),
        path: entryFolder(collection, entry.id),
        revision,
        data: entry.data,
      };
    }),
  );

  server.registerTool(
    "get_singleton",
    {
      title: "Read a singleton",
      description: "All data of a singleton, such as the website's settings, and its revision for the next save.",
      inputSchema: z.object({ name: z.string() }),
      ...read,
    },
    run(async ({ name }: { name: string }) => ({
      name,
      path: entryFolder(name),
      revision: await content().revisionOfSingleton(name),
      data: await content().getSingleton(name),
    })),
  );

  server.registerTool(
    "find_references",
    {
      title: "Find references",
      description: "The entries and singletons that link to an entry. Read them before you delete or rename the entry.",
      inputSchema: z.object({ collection: z.string(), id: z.string() }),
      ...read,
    },
    run(async ({ collection, id }: { collection: string; id: string }) => ({
      references: await content().findReferences(collection, id),
    })),
  );

  server.registerTool(
    "find_reference_items",
    {
      title: "Find items of reference data",
      description:
        "The items of a reference set that `describe_model` names, by a part of the title or the id: at most 50. A relation to the set stores the item's `id`. Mica cannot change reference data.",
      inputSchema: z.object({ name: z.string(), query: z.string().optional().describe("A part of the title or the id. Empty: the first items.") }),
      ...read,
    },
    run(async ({ name, query }: { name: string; query?: string | undefined }) => {
      const set = Object.hasOwn(ctx.site.model.references ?? {}, name) ? ctx.site.model.references![name] : undefined;
      if (!set) throw new ApiError("not_found", `There is no reference set "${name}".`);
      const items = await readReferenceIndex(ctx.site.contentRepository, name);
      if (!items) throw new ApiError("not_found", `${set.label} has no index yet. The developer builds the website and commits .mica/references/${name}.json.`);
      const needle = (query ?? "").trim().toLowerCase();
      const found = items.filter((item) => !needle || item.title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle));
      return { items: found.slice(0, 50), total: found.length };
    }),
  );

  server.registerTool(
    "list_media",
    {
      title: "List media",
      description: "Every media file in the content: its path, which a media field stores, its type and its size.",
      inputSchema: z.object({}),
      ...read,
    },
    run(async () => ({ media: await ctx.services.media.list() })),
  );

  server.registerTool(
    "get_changes",
    {
      title: "Show the drafts",
      description:
        "The saved changes that are not published yet, with the revision of each file, and the problems that stop a publication. discard_changes and publish take these paths and revisions.",
      inputSchema: z.object({}),
      ...read,
    },
    run(async () => {
      const status = await ctx.services.staging.status();
      return { changes: status.changes, validation: status.validation, publish: status.publish };
    }),
  );

  server.registerTool(
    "save_entry",
    {
      title: "Save an entry",
      description:
        "Creates an entry, or replaces the data of one. Without `id`, it creates a new entry, and the ID comes from the data. With `id`, send the `revision` from get_entry. The result is a draft until it is published.",
      inputSchema: z.object({
        collection: z.string(),
        data: z.record(z.string(), z.unknown()).describe("All fields of the entry, in the formats of describe_model."),
        id: z.string().optional().describe("The entry to replace. Absent: create a new entry."),
        revision: z.string().optional().describe("The revision from get_entry. Required with `id`."),
        updateLinks: z.boolean().optional().describe("When the ID changes: change the links in other entries to the new ID."),
      }),
      ...write,
    },
    runWrite(async (input: { collection: string; data: Record<string, unknown>; id?: string | undefined; revision?: string | undefined; updateLinks?: boolean | undefined }) => {
      if (input.id !== undefined && input.revision === undefined) {
        throw new ApiError("bad_request", "Send the revision from get_entry, so that the save cannot overwrite a newer one.");
      }
      return content().save(input.collection, {
        data: input.data,
        // `null` on a create asserts that the entry does not exist yet.
        expectedRevision: input.id === undefined ? null : input.revision!,
        ...(input.id !== undefined ? { id: input.id } : {}),
        ...(input.updateLinks ? { updateLinks: true } : {}),
      });
    }),
  );

  server.registerTool(
    "save_singleton",
    {
      title: "Save a singleton",
      description: "Replaces the data of a singleton. Send the `revision` from get_singleton. The result is a draft until it is published.",
      inputSchema: z.object({
        name: z.string(),
        data: z.record(z.string(), z.unknown()).describe("All fields of the singleton, in the formats of describe_model."),
        revision: z.string().nullable().describe("The revision from get_singleton; null when it has none yet."),
      }),
      ...write,
    },
    runWrite(async ({ name, data, revision }: { name: string; data: Record<string, unknown>; revision: string | null }) =>
      content().saveSingleton(name, data, { expectedRevision: revision }),
    ),
  );

  server.registerTool(
    "delete_entry",
    {
      title: "Delete an entry",
      description: "Deletes an entry with its rich text and media, as a draft. Publish refuses a deletion that would break a link: see find_references.",
      inputSchema: z.object({ collection: z.string(), id: z.string(), revision: z.string().describe("The revision from get_entry.") }),
      ...write,
      annotations: { destructiveHint: true },
    },
    runWrite(async ({ collection, id, revision }: { collection: string; id: string; revision: string }) => {
      await content().remove(collection, id, { expectedRevision: revision });
      return { deleted: `${collection}/${id}` };
    }),
  );

  server.registerTool(
    "reorder_entries",
    {
      title: "Reorder entries",
      description: "Sets the order of a sortable collection. Send every ID in the new order, and the `orderRevision` from list_entries.",
      inputSchema: z.object({
        collection: z.string(),
        ids: z.array(z.string()).max(2000),
        revision: z.string().nullable().describe("The orderRevision from list_entries."),
      }),
      ...write,
    },
    runWrite(async ({ collection, ids, revision }: { collection: string; ids: string[]; revision: string | null }) => ({
      orderRevision: await content().reorder(collection, ids, revision),
    })),
  );

  server.registerTool(
    "upload_media",
    {
      title: "Upload a file",
      description:
        `Adds a file to the content, as a draft: an image, a PDF, or a GPX, KML, GeoJSON, ZIP or CSV file. The result's \`path\` is the value for a media field. ${options.localFiles ? "Give the file's path on this machine in `file`, or its bytes as base64 in `content`." : "Send its bytes as base64 in `content`."}`,
      // Without local files, `file` is not offered at all, and `uploadBody` refuses it.
      inputSchema: options.localFiles ? uploadInput : (uploadInput.omit({ file: true }) as unknown as typeof uploadInput),
      ...write,
    },
    runWrite(async (input: { name: string; directory?: string | undefined; content?: string | undefined; file?: string | undefined; accept?: MediaAccept | undefined }) => {
      const { body, size, close } = await uploadBody(input, options);
      try {
        return await storeUpload(ctx, {
          body,
          size,
          name: input.name,
          ...(input.directory !== undefined ? { directory: input.directory } : {}),
          accept: input.accept ?? "any",
        });
      } finally {
        // A refused upload never reads the file: its descriptor must not stay open.
        close?.();
      }
    }),
  );

  server.registerTool(
    "discard_changes",
    {
      title: "Discard drafts",
      description: "Throws away saved changes that are not published, with the paths and revisions from get_changes. This cannot be undone.",
      inputSchema: z.object({ paths: z.record(z.string(), z.string().nullable()).describe("Path → revision, from get_changes.") }),
      ...write,
      annotations: { destructiveHint: true },
    },
    runWrite(async ({ paths }: { paths: Record<string, string | null> }) => ctx.services.staging.discard(paths, editor(caller))),
  );

  if (options.publish) {
    server.registerTool(
      "publish",
      {
        title: "Publish",
        description:
          "Publishes drafts to the website, with the paths and revisions from get_changes. Then the website is built again. Ask the person before you publish.",
        inputSchema: z.object({
          message: z.string().max(500).describe("What changed, in one line, for the website's history."),
          paths: z.record(z.string(), z.string().nullable()).describe("Path → revision, from get_changes."),
        }),
        scopeChallenge: needs(SCOPES.publish),
        annotations: { destructiveHint: true, openWorldHint: true },
      },
      runWrite(async ({ message, paths }: { message: string; paths: Record<string, string | null> }) =>
        publishChanges(ctx, { message, paths, author: author(caller), editor: editor(caller) }),
      ),
    );
  }

  return server;
}
