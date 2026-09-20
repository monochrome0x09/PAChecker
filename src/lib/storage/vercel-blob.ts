import "server-only";

import { randomUUID } from "node:crypto";
import { BlobNotFoundError, del, get, put } from "@vercel/blob";

import {
  ImageStorageValidationError,
  StoredImageNotFoundError,
  validateImageBytes,
  type StoredImage,
  type SupportedImageMimeType,
} from "./local";

const MIME_EXTENSIONS: Record<SupportedImageMimeType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function normalizeOriginalFilename(filename: string | null | undefined): string | null {
  if (!filename) {
    return null;
  }
  const normalized = filename
    .replace(/[\\/\0]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .slice(0, 255);
  return normalized || null;
}

function validateStorageKey(storageKey: string): void {
  if (
    !storageKey.startsWith("images/") ||
    storageKey.includes("\0") ||
    storageKey.includes("..") ||
    !/^[A-Za-z0-9._/-]+$/.test(storageKey)
  ) {
    throw new ImageStorageValidationError("Invalid storage key");
  }
}

export async function saveImage(
  bytes: Uint8Array,
  mimeType: string,
  originalFilename?: string | null,
): Promise<StoredImage> {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  validateImageBytes(normalizedMimeType, bytes);

  const requestedPathname = `images/${randomUUID()}${MIME_EXTENSIONS[normalizedMimeType]}`;
  const blob = await put(requestedPathname, Buffer.from(bytes), {
    access: "private",
    addRandomSuffix: false,
    contentType: normalizedMimeType,
  });

  // Persist the SDK's pathname, not its private URL, as the repository key.
  validateStorageKey(blob.pathname);
  return {
    storageKey: blob.pathname,
    originalFilename: normalizeOriginalFilename(originalFilename),
    mimeType: normalizedMimeType,
    sizeBytes: bytes.length,
  };
}

export async function readImage(storageKey: string): Promise<Buffer> {
  validateStorageKey(storageKey);
  const blob = await get(storageKey, { access: "private" });
  if (!blob?.stream || blob.statusCode !== 200) {
    throw new StoredImageNotFoundError();
  }
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}

export async function deleteImage(storageKey: string): Promise<boolean> {
  validateStorageKey(storageKey);
  try {
    await del(storageKey);
    return true;
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return false;
    }
    throw error;
  }
}
