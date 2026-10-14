/**
 * Media uploads. Every upload is checked here for size and for its real content
 * type, read from the bytes. An upload is a file in the content repository; its
 * name is slugified and unique in its own directory.
 */

import path from "node:path";

import { contentPath, ContentPathError, MEDIA_DIR, slugify } from "@micacms/core/internal";
import type { ContentFiles } from "../workspace/files.js";
import { imageSize } from "image-size";

import { ApiError, badRequest } from "../lib/errors.js";
import { detectFileType, isAccepted, isImageType, SVG_TYPE, VIDEO_TYPE } from "../lib/file-type.js";

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

export function createMediaService(deps: MediaServiceDeps) {
  const { files, maxBytes } = deps;
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

  return {
    /** Reads and checks an upload, without writing it. */
    async prepare(input: {
      file: File;
      /** Directory to place the file in, relative to the content root. */
      directory?: string;
      accept?: "image" | "document" | "any";
    }): Promise<{ file: MediaFile; contents: Uint8Array }> {
      const { file } = input;
      const directory = uploadDirectory(input.directory ?? MEDIA_DIR);

      if (file.size === 0) throw badRequest("The file is empty.");
      if (file.size > maxBytes) {
        throw new ApiError(
          "payload_too_large",
          `The file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`,
        );
      }

      const contents = new Uint8Array(await file.arrayBuffer());
      // From the bytes, never from the browser's claim.
      const detected = detectFileType(contents);

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
        const bytes = await files.readBinary(path);
        if (!bytes) return null;
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

/** A slugified filename: safe as a path segment and as part of a URL. */
function safeName(original: string, extension: string): string {
  const stem = slugify(path.basename(original).replace(/\.[^.]*$/, "")).slice(0, 80);
  return `${stem || "upload"}.${extension}`;
}

/** Extension to media type, only for formats that byte-sniffing does not identify. */
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
 * The bytes win over the extension, except that an SVG name always counts, so a
 * leading comment cannot hide an SVG.
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
