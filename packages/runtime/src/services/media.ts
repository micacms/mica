/**
 * Media uploads. Every upload is checked here for size and for its real content
 * type, read from the bytes. An upload is a file in the content repository; its
 * name has lower-case letters, digits and hyphens, and is unique in its own
 * directory. No whole file is held in memory: an upload streams to disk, and a
 * read is a stream or the file's head.
 */

import path from "node:path";

import { acceptLabel, contentPath, ContentPathError, MEDIA_DIR, MEDIA_FILE_TYPES, mediaFileTypeOf, toId, type MediaAccept } from "@micacms/core/internal";
import { HEAD_BYTES, TooLargeError, type ContentFiles, type FileChange } from "../workspace/files.js";
import { imageSize } from "image-size";

import { ApiError, badRequest } from "../lib/errors.js";
import { detectFileType, isAccepted, isImageType, isLfsPointer, SVG_TYPE, VIDEO_TYPE } from "../lib/file-type.js";

export interface MediaServiceDeps {
  files: ContentFiles;
  maxBytes: number;
}

export interface MediaFile {
  /** Path relative to the content root: the value a `media()` field holds. */
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

let uploads = 0;

export function createMediaService(deps: MediaServiceDeps) {
  const { files, maxBytes } = deps;
  const tooLarge = (size?: number) =>
    new ApiError(
      "payload_too_large",
      size === undefined
        ? `The file is larger than the limit of ${formatBytes(maxBytes)}.`
        : `The file is ${formatBytes(size)}. The limit is ${formatBytes(maxBytes)}.`,
    );
  const dimensionCache = new Map<string, { mimeType: string; width: number | null; height: number | null }>();

  /** A name that is unique in `directory`. Only there can a collision overwrite a file. */
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

  /** Removes the temporary file of an upload that is not applied. */
  const discard = async (temporary: string): Promise<void> => {
    await files.apply({ changes: [{ type: "delete", path: temporary }] }).catch(() => {});
  };

  return {
    /**
     * Writes an upload to a temporary file in its folder, and checks its size
     * and its type from the first bytes. Returns the changes that put it in
     * place; the caller applies them, or calls `discard`.
     */
    async receive(input: {
      body: ReadableStream<Uint8Array>;
      /** The name in the browser, for the new name. */
      name: string;
      /** From Content-Length, to refuse a large file before it arrives. */
      size?: number;
      /** Directory to place the file in, relative to the content root. */
      directory?: string;
      accept?: MediaAccept;
    }): Promise<{ file: MediaFile; changes: FileChange[]; temporary: string }> {
      const directory = uploadDirectory(input.directory ?? MEDIA_DIR);
      if (input.size !== undefined && input.size > maxBytes) throw tooLarge(input.size);

      const temporary = `${directory}/upload.mica-${process.pid}-${uploads++}`;
      let received: { size: number; head: Uint8Array };
      try {
        received = await files.receive(temporary, input.body, maxBytes);
      } catch (error) {
        if (error instanceof TooLargeError) throw tooLarge();
        throw error;
      }

      try {
        if (received.size === 0) throw badRequest("The file is empty.");
        // From the bytes, never from the browser's claim.
        const detected = detectFileType(received.head, input.name);
        if (!detected) {
          throw new ApiError("unsupported_media_type", "This file type is not supported.");
        }
        if (detected.mimeType === SVG_TYPE) throw refuseSvg();
        if (detected.mimeType === VIDEO_TYPE) {
          throw new ApiError(
            "unsupported_media_type",
            "Mica does not keep videos: they make the website's files large. Put the video on a video service, and link to it.",
          );
        }
        if (!isAccepted(detected.mimeType, input.accept)) {
          const type = mediaFileTypeOf(detected.mimeType);
          throw new ApiError(
            "unsupported_media_type",
            `This field takes ${acceptLabel(input.accept)}. This file is ${type ? `one of the ${MEDIA_FILE_TYPES[type].label}` : `a ${detected.mimeType}`}.`,
          );
        }

        const filename = await uniqueName(directory, safeName(input.name, detected.extension));
        const path = `${directory}/${filename}`;
        return {
          temporary,
          changes: [
            { type: "copy", from: temporary, path },
            { type: "delete", path: temporary },
          ],
          file: {
            path,
            filename,
            mimeType: detected.mimeType,
            size: received.size,
            ...dimensions(received.head, detected.mimeType),
          },
        };
      } catch (error) {
        await discard(temporary);
        throw error;
      }
    },

    discard,

    /**
     * Every media file in the repository, from directory listings and `stat`:
     * no file is read (#75). The type comes from the name, which the upload
     * chose from the bytes; the dimensions come from `info`, for one file.
     */
    async list(): Promise<MediaFile[]> {
      const found: MediaFile[] = [];

      const walk = async (directory: string): Promise<void> => {
        const items = await files.list(directory);
        await Promise.all(
          items.map(async (item) => {
            const child = directory === "" ? item.name : `${directory}/${item.name}`;
            if (item.type === "directory") return walk(child);
            if (!isMediaName(item.name)) return;
            const mimeType = listedType(item.name);
            if (mimeType === SVG_TYPE) return;
            const info = await files.stat(child);
            if (!info) return;
            found.push({ path: child, filename: item.name, mimeType, size: info.size, width: null, height: null });
          }),
        );
      };

      await walk("");
      return found.sort((a, b) => a.path.localeCompare(b.path));
    },

    /** One file with its dimensions, which only this reads. Cached by path, size and last change. */
    async info(mediaPath: string): Promise<MediaFile | null> {
      const path = contentPath(mediaPath);
      const info = await files.stat(path);
      if (!info) return null;
      const key = `${path}\0${info.size}\0${info.modifiedAt}`;
      let cached = dimensionCache.get(key);
      if (!cached) {
        const bytes = await files.readHead(path, HEAD_BYTES);
        if (!bytes) return null;
        if (isLfsPointer(bytes)) throw notDownloaded();
        const mimeType = typeOf(bytes, path);
        if (mimeType === SVG_TYPE) throw refuseSvg();
        cached = { mimeType, ...dimensions(bytes, mimeType) };
        if (dimensionCache.size >= 2_000) dimensionCache.clear();
        dimensionCache.set(key, cached);
      }
      return { path, filename: path.split("/").at(-1)!, size: info.size, ...cached };
    },

    /** Size and last change, for the file route's ETag. */
    stat(mediaPath: string) {
      return files.stat(contentPath(mediaPath));
    },

    /** A file as a stream, with its type from its first bytes. */
    async read(mediaPath: string): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string } | null> {
      const path = contentPath(mediaPath);
      const head = await files.readHead(path, 1024);
      if (!head) return null;
      if (isLfsPointer(head)) throw notDownloaded();

      const mimeType = typeOf(head, mediaPath);
      if (mimeType === SVG_TYPE) throw refuseSvg();
      const stream = await files.readStream(path);
      return stream && { stream, mimeType };
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

/** A file name of lower-case letters, digits and hyphens: safe as a path segment and as part of a URL. */
function safeName(original: string, extension: string): string {
  const stem = toId(path.basename(original).replace(/\.[^.]*$/, "")).slice(0, 80);
  return `${stem || "upload"}.${extension}`;
}

/** Extension to media type, only for formats that byte-sniffing does not identify. */
const BY_EXTENSION: Record<string, string> = {
  svg: "image/svg+xml",
  pdf: "application/pdf",
  gpx: "application/gpx+xml",
  kml: "application/vnd.google-earth.kml+xml",
  geojson: "application/geo+json",
  zip: "application/zip",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * The bytes win over the extension, except that an SVG name always counts, so a
 * leading comment cannot hide an SVG.
 */
function typeOf(bytes: Uint8Array, name: string): string {
  const byName = mimeFromName(name);
  if (byName === SVG_TYPE) return SVG_TYPE;
  return detectFileType(bytes, name)?.mimeType ?? byName;
}

/** The working tree holds an LFS pointer where the file should be. */
const notDownloaded = () =>
  new ApiError(
    "conflict",
    "Mica has only a placeholder for this file, because the file itself was not downloaded. Tell the person who runs Mica.",
  );

const refuseSvg = () =>
  new ApiError(
    "unsupported_media_type",
    "Mica does not accept SVG files, because they can contain scripts. Use PNG or WebP instead.",
  );

/**
 * The type the media list shows, from the name only. An image name stands for
 * its image type here: the upload chose the name from the bytes, and serving a
 * file still reads the bytes (`typeOf`).
 */
const IMAGE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function listedType(name: string): string {
  return IMAGE_BY_EXTENSION[path.extname(name).slice(1).toLowerCase()] ?? mimeFromName(name);
}

function mimeFromName(name: string): string {
  const extension = path.extname(name).slice(1).toLowerCase();
  return BY_EXTENSION[extension] ?? "application/octet-stream";
}

/** Files a `media()` field could plausibly point at. */
function isMediaName(name: string): boolean {
  return /\.(jpe?g|png|webp|avif|gif|tiff?|pdf|gpx|kml|geojson|zip|docx?|xlsx?|txt|csv)$/i.test(name);
}

function dimensions(
  bytes: Uint8Array,
  mimeType: string,
): { width: number | null; height: number | null } {
  if (bytes.byteLength === 0 || !isImageType(mimeType)) {
    return { width: null, height: null };
  }
  // `bytes` can be the head of the file only: a JPEG with a large preview may not show its size there.
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
