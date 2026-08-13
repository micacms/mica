/**
 * Media uploads.
 *
 * Every uploaded byte passes through here, so this is where the file is judged:
 * size, real content type (from the bytes, not the browser's claim), and the
 * generated storage key. The filename the user chose is kept as a display
 * label only — it never reaches the filesystem.
 */

import { createHash } from "node:crypto";
import path from "node:path";

import { imageSize } from "image-size";

import { ApiError, badRequest, notFound } from "../lib/errors.js";
import { detectFileType, isAccepted, isImageType } from "../lib/file-type.js";
import { ulid } from "../lib/id.js";
import type { Logger } from "../lib/logger.js";
import type { MediaRecord, MediaRepository } from "../repositories/media.js";
import type { MediaStorage } from "./storage.js";

export interface MediaServiceDeps {
  media: MediaRepository;
  storage: MediaStorage;
  maxBytes: number;
  logger?: Logger;
}

/** Keeps the original name recognisable without letting it drive the path. */
function displayName(original: string, extension: string): string {
  const base = path
    .basename(original)
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .trim()
    .slice(0, 100);

  return `${base || "upload"}.${extension}`;
}

function dimensions(bytes: Uint8Array, mimeType: string): { width: number | null; height: number | null } {
  if (!isImageType(mimeType) || mimeType === "image/svg+xml") {
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

export function createMediaService(deps: MediaServiceDeps) {
  const { media, storage, maxBytes, logger } = deps;

  return {
    async upload(input: {
      file: File;
      accept?: "image" | "document" | "any";
      altText?: string;
      userId: string | null;
    }): Promise<{ record: MediaRecord; deduplicated: boolean }> {
      const { file } = input;
      const accept = input.accept ?? "any";

      if (file.size === 0) {
        throw badRequest("The file is empty.");
      }
      if (file.size > maxBytes) {
        throw new ApiError(
          "payload_too_large",
          `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`,
        );
      }

      const bytes = new Uint8Array(await file.arrayBuffer());

      // Re-check after reading: `File.size` is a claim until the bytes arrive.
      if (bytes.byteLength > maxBytes) {
        throw new ApiError("payload_too_large", "The file exceeds the upload limit.");
      }

      const detected = detectFileType(bytes);
      if (!detected) {
        throw new ApiError(
          "unsupported_media_type",
          `"${file.name}" is not a supported file type. Upload a JPEG, PNG, WebP, AVIF, GIF, SVG, PDF or MP4.`,
        );
      }
      if (!isAccepted(detected.mimeType, accept)) {
        throw new ApiError(
          "unsupported_media_type",
          accept === "image"
            ? `This field only accepts images; "${file.name}" is ${detected.mimeType}.`
            : `"${file.name}" is not accepted here (${detected.mimeType}).`,
        );
      }

      const checksum = createHash("sha256").update(bytes).digest("hex");

      // Identical bytes are stored once — a logo re-uploaded on five pages is
      // one file, and the reference stays stable.
      const existing = media.findByChecksum(checksum);
      if (existing && (await storage.exists(existing.storageKey))) {
        logger?.debug("Reusing identical upload", { id: existing.id, checksum });
        return { record: existing, deduplicated: true };
      }

      const id = ulid();
      const storageKey = `${id}.${detected.extension}`;
      const { width, height } = dimensions(bytes, detected.mimeType);

      await storage.put(storageKey, bytes);

      try {
        const record = media.create({
          id,
          filename: displayName(file.name, detected.extension),
          storageKey,
          mimeType: detected.mimeType,
          width,
          height,
          size: bytes.byteLength,
          altText: input.altText ?? "",
          checksum,
          userId: input.userId,
        });

        logger?.info("Media uploaded", { id, mimeType: detected.mimeType, size: bytes.byteLength });
        return { record, deduplicated: false };
      } catch (error) {
        // Never leave bytes on disk without a row pointing at them.
        await storage.delete(storageKey).catch(() => {});
        throw error;
      }
    },

    async delete(id: string): Promise<void> {
      const record = media.find(id);
      if (!record) throw notFound("This file no longer exists.");

      // Row first: an orphaned file wastes disk, an orphaned row breaks pages.
      media.delete(id);
      await storage.delete(record.storageKey);
      logger?.info("Media deleted", { id });
    },

    /** Files still referenced by an entry or global, keyed by id. */
    usageFlags(): Set<string> {
      return media.referencedIds();
    },
  };
}

export type MediaService = ReturnType<typeof createMediaService>;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
