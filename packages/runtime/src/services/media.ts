/**
 * Media uploads.
 *
 * Every uploaded byte passes through here, so this is where the file is judged:
 * size, and the real content type read from the bytes rather than from the
 * browser's claim.
 *
 * An upload is a *file in the content repository*. There is no media table, no
 * generated key and no object store — a media value is the path to a file a
 * reviewer can see in the diff.
 *
 * The filename therefore matters. It is derived from what the editor uploaded,
 * slugified so it is safe as a path segment, and made unique inside its own
 * directory rather than globally.
 */

import path from "node:path";

import { contentPath, ContentPathError, MEDIA_DIR, slugify } from "@micacms/core";
import type { ContentFiles } from "../workspace/files.js";
import { imageSize } from "image-size";

import { ApiError, badRequest } from "../lib/errors.js";
import { detectFileType, isAccepted, isImageType, SVG_TYPE } from "../lib/file-type.js";

/** Where uploads go when they are not attached to a particular entry. */
export const SHARED_MEDIA_DIR = "media";

export interface MediaServiceDeps {
  files: ContentFiles;
  maxBytes: number;
}

export interface MediaFile {
  /** Path relative to the content root — the value a `media()` field holds. */
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

export function createMediaService(deps: MediaServiceDeps) {
  const { files, maxBytes } = deps;

  /**
   * A name that is unique in `directory`.
   *
   * Scoped to the directory rather than to the whole repository, because that
   * is where a collision would actually overwrite something — and because
   * `haus-a/media/exterior.jpg` and `haus-b/media/exterior.jpg` are two
   * perfectly reasonable files with the same name.
   */
  const uniqueName = async (directory: string, filename: string): Promise<string> => {
    const taken = new Set(
      (await files.list(directory)).filter((item) => item.type === "file").map((item) => item.name),
    );

    const extension = path.extname(filename);
    const stem = filename.slice(0, filename.length - extension.length);

    let candidate = filename;
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${stem}-${n}${extension}`;
    return candidate;
  };

  return {
    /**
     * Reads and checks an upload, without writing it.
     *
     * Separate from the commit so that an entry and the media it references go
     * into the repository in *one* change set. Uploading first and saving
     * second would leave an orphaned file behind whenever the editor changed
     * their mind.
     */
    async prepare(input: {
      file: File;
      /** Directory to place the file in, relative to the content root. */
      directory?: string;
      accept?: "image" | "document" | "any";
    }): Promise<{ file: MediaFile; contents: Uint8Array }> {
      const { file } = input;
      const directory = uploadDirectory(input.directory ?? SHARED_MEDIA_DIR);

      if (file.size === 0) throw badRequest("The file is empty.");
      if (file.size > maxBytes) {
        throw new ApiError(
          "payload_too_large",
          `The file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`,
        );
      }

      const contents = new Uint8Array(await file.arrayBuffer());
      // From the bytes, never from the browser's claim about them.
      const detected = detectFileType(contents);

      if (!detected) {
        throw new ApiError("unsupported_media_type", "This file type is not supported.");
      }
      if (detected.mimeType === SVG_TYPE) throw refuseSvg();
      if (!isAccepted(detected.mimeType, input.accept ?? "any")) {
        throw new ApiError(
          "unsupported_media_type",
          `A ${input.accept} was expected, but this is a ${detected.mimeType}.`,
        );
      }

      const filename = await uniqueName(directory, safeName(file.name, detected.extension));

      return {
        contents,
        file: {
          path: `${directory}/${filename}`,
          filename,
          mimeType: detected.mimeType,
          size: contents.byteLength,
          ...dimensions(contents, detected.mimeType),
        },
      };
    },

    /**
     * Every media file in the repository, for the editor's picker.
     *
     * A walk of the content tree rather than a table scan. Content trees are
     * small, and the alternative — an index Mica maintains — would be a second
     * source of truth that could disagree with the repository.
     */
    async list(): Promise<MediaFile[]> {
      const found: MediaFile[] = [];

      const walk = async (directory: string): Promise<void> => {
        for (const item of await files.list(directory)) {
          const child = directory === "" ? item.name : `${directory}/${item.name}`;

          if (item.type === "directory") {
            await walk(child);
            continue;
          }

          if (!isMediaName(item.name)) continue;

          const bytes = await files.readBinary(child);
          if (!bytes) continue;

          const mimeType = typeOf(bytes, item.name);
          if (mimeType === SVG_TYPE) continue;

          found.push({
            path: child,
            filename: item.name,
            mimeType,
            size: bytes.byteLength,
            ...dimensions(bytes, mimeType),
          });
        }
      };

      await walk("");
      return found.sort((a, b) => a.path.localeCompare(b.path));
    },

    async read(mediaPath: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
      const bytes = await files.readBinary(contentPath(mediaPath));
      if (!bytes) return null;

      const mimeType = typeOf(bytes, mediaPath);
      if (mimeType === SVG_TYPE) throw refuseSvg();
      return { bytes, mimeType };
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;

/** An upload goes into a `media/` folder inside the content root, and nowhere else. */
function uploadDirectory(directory: string): string {
  let clean: string;
  try {
    clean = contentPath(directory);
  } catch (error) {
    if (error instanceof ContentPathError) throw badRequest(error.message);
    throw error;
  }
  if (clean.split("/").at(-1) !== MEDIA_DIR) {
    throw badRequest(`Uploads go into a "${MEDIA_DIR}" folder, not "${directory}".`);
  }
  return clean;
}

/* ------------------------------------------------------------------ */

/**
 * A filename that is safe as a path segment and still recognisable.
 *
 * Slugified rather than sanitised: the result is part of a URL in the built
 * site and part of a path in a Git repository, and both are better off without
 * spaces, accents or case.
 */
function safeName(original: string, extension: string): string {
  const stem = slugify(path.basename(original).replace(/\.[^.]*$/, "")).slice(0, 80);
  return `${stem || "upload"}.${extension}`;
}

/**
 * Extension to media type, for the formats byte-sniffing does not identify.
 *
 * A fallback, never the first answer: a file's own bytes are the only thing
 * that cannot be renamed to lie.
 */
const BY_EXTENSION: Record<string, string> = {
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * The bytes are authoritative; the extension is the fallback for formats the
 * sniffer does not cover. An SVG name counts even when its bytes do not look
 * like one, so that a leading comment cannot slip one past the refusal.
 */
function typeOf(bytes: Uint8Array, name: string): string {
  const byName = mimeFromName(name);
  if (byName === SVG_TYPE) return SVG_TYPE;
  return detectFileType(bytes)?.mimeType ?? byName;
}

const refuseSvg = () =>
  new ApiError(
    "unsupported_media_type",
    "Mica does not accept SVG files, because they can contain scripts. Use PNG or WebP instead.",
  );

function mimeFromName(name: string): string {
  const extension = path.extname(name).slice(1).toLowerCase();
  return BY_EXTENSION[extension] ?? "application/octet-stream";
}

/** Files a `media()` field could plausibly point at. */
function isMediaName(name: string): boolean {
  return /\.(jpe?g|png|webp|avif|gif|tiff?|pdf|docx?|xlsx?|txt|csv)$/i.test(name);
}

function dimensions(
  bytes: Uint8Array,
  mimeType: string,
): { width: number | null; height: number | null } {
  if (bytes.byteLength === 0 || !isImageType(mimeType)) {
    return { width: null, height: null };
  }
  try {
    const size = imageSize(Buffer.from(bytes));
    return { width: size.width ?? null, height: size.height ?? null };
  } catch {
    // A format image-size cannot read is still a valid upload.
    return { width: null, height: null };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
