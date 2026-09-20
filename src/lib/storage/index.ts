import "server-only";

import {
  deleteImage as deleteLocalImage,
  readImage as readLocalImage,
  saveImage as saveLocalImage,
  StorageConfigurationError,
  type StoredImage as LocalStoredImage,
} from "./local";
import {
  deleteImage as deleteR2Image,
  readImage as readR2Image,
  saveImage as saveR2Image,
} from "./r2";
import {
  deleteImage as deleteVercelBlobImage,
  readImage as readVercelBlobImage,
  saveImage as saveVercelBlobImage,
} from "./vercel-blob";

export {
  DEFAULT_MAX_UPLOAD_BYTES,
  getMaxUploadBytes,
  ImageStorageValidationError,
  StorageConfigurationError,
  StoredImageNotFoundError,
  SUPPORTED_IMAGE_MIME_TYPES,
  validateImageBytes,
  type StoredImage,
  type SupportedImageMimeType,
} from "./local";

type StorageProvider = "local" | "r2" | "vercel-blob";

function getStorageProvider(): StorageProvider {
  const defaultProvider = process.env.VERCEL ? "vercel-blob" : "local";
  const provider = (process.env.PACHECKER_STORAGE_PROVIDER ?? defaultProvider)
    .trim()
    .toLowerCase();

  if (provider !== "local" && provider !== "r2" && provider !== "vercel-blob") {
    throw new StorageConfigurationError(
      `Unsupported PACHECKER_STORAGE_PROVIDER: ${provider || "(empty)"}`,
    );
  }

  if (process.env.VERCEL && provider === "local") {
    throw new StorageConfigurationError(
      "Local image storage is not durable on Vercel. Configure a durable object-storage provider before enabling image uploads.",
    );
  }

  return provider;
}

export async function saveImage(
  bytes: Uint8Array,
  mimeType: string,
  originalFilename?: string | null,
): Promise<LocalStoredImage> {
  const provider = getStorageProvider();
  if (provider === "r2") {
    return saveR2Image(bytes, mimeType, originalFilename);
  }
  if (provider === "vercel-blob") {
    return saveVercelBlobImage(bytes, mimeType, originalFilename);
  }
  return saveLocalImage(bytes, mimeType, originalFilename);
}

export async function readImage(storageKey: string): Promise<Buffer> {
  const provider = getStorageProvider();
  if (provider === "r2") {
    return readR2Image(storageKey);
  }
  if (provider === "vercel-blob") {
    return readVercelBlobImage(storageKey);
  }
  return readLocalImage(storageKey);
}

export async function deleteImage(storageKey: string): Promise<boolean> {
  const provider = getStorageProvider();
  if (provider === "r2") {
    return deleteR2Image(storageKey);
  }
  if (provider === "vercel-blob") {
    return deleteVercelBlobImage(storageKey);
  }
  return deleteLocalImage(storageKey);
}
