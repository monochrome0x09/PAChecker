import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type StoredImage = {
  storageKey: string;
  originalFilename: string | null;
  mimeType: SupportedImageMimeType;
  sizeBytes: number;
};

export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

export class ImageStorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageStorageValidationError";
  }
}

export class StoredImageNotFoundError extends Error {
  constructor() {
    super("Stored image file not found");
    this.name = "StoredImageNotFoundError";
  }
}

const MIME_EXTENSIONS: Record<SupportedImageMimeType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function isSupportedMimeType(value: string): value is SupportedImageMimeType {
  return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

function storageRoot(): string {
  const configured = process.env.PACHECKER_STORAGE_DIR ?? process.env.UPLOAD_DIR ?? "data/uploads";
  if (!configured.trim()) {
    throw new StorageConfigurationError("PACHECKER_STORAGE_DIR must not be empty");
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function getMaxUploadBytes(): number {
  const configured = process.env.PACHECKER_MAX_UPLOAD_BYTES;
  if (configured === undefined || configured.trim() === "") {
    return DEFAULT_MAX_UPLOAD_BYTES;
  }

  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new StorageConfigurationError("PACHECKER_MAX_UPLOAD_BYTES must be a positive integer");
  }
  return parsed;
}

function detectImageMimeType(bytes: Uint8Array): SupportedImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function validateImageBytes(
  mimeType: string,
  bytes: Uint8Array,
): asserts mimeType is SupportedImageMimeType {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  if (!isSupportedMimeType(normalizedMimeType)) {
    throw new ImageStorageValidationError(
      "Only JPEG, PNG, WebP, and GIF images are supported",
    );
  }
  if (bytes.length === 0) {
    throw new ImageStorageValidationError("Image file is empty");
  }
  if (bytes.length > getMaxUploadBytes()) {
    throw new ImageStorageValidationError(
      `Image file exceeds the ${getMaxUploadBytes()} byte limit`,
    );
  }

  const detectedMimeType = detectImageMimeType(bytes);
  if (detectedMimeType !== normalizedMimeType) {
    throw new ImageStorageValidationError("Image MIME type does not match its file content");
  }

  // The assertion above only narrows the caller's value after the normalized
  // value has passed the allow-list check.
  mimeType = normalizedMimeType;
}

function normalizeOriginalFilename(filename: string | null | undefined): string | null {
  if (!filename) {
    return null;
  }
  const withoutSeparators = filename.replace(/[\\/\0]/g, "_");
  const basename = path.basename(withoutSeparators).replace(/[\u0000-\u001f\u007f]/g, "_");
  return basename.slice(0, 255) || null;
}

function safeStoragePath(storageKey: string): string {
  if (!storageKey || storageKey.includes("\0") || path.isAbsolute(storageKey)) {
    throw new ImageStorageValidationError("Invalid storage key");
  }

  const root = storageRoot();
  const resolved = path.resolve(root, storageKey);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new ImageStorageValidationError("Invalid storage key");
  }
  return resolved;
}

export async function saveImage(
  bytes: Uint8Array,
  mimeType: string,
  originalFilename?: string | null,
): Promise<StoredImage> {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  validateImageBytes(normalizedMimeType, bytes);

  const extension = MIME_EXTENSIONS[normalizedMimeType];
  const storageKey = `images/${randomUUID()}${extension}`;
  const destination = safeStoragePath(storageKey);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx" });

  return {
    storageKey,
    originalFilename: normalizeOriginalFilename(originalFilename),
    mimeType: normalizedMimeType,
    sizeBytes: bytes.length,
  };
}

export async function readImage(storageKey: string): Promise<Buffer> {
  const filename = safeStoragePath(storageKey);
  try {
    return await readFile(filename);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new StoredImageNotFoundError();
    }
    throw error;
  }
}

export async function deleteImage(storageKey: string): Promise<boolean> {
  const filename = safeStoragePath(storageKey);
  try {
    await unlink(filename);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
