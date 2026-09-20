import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";

import {
  ImageStorageValidationError,
  StorageConfigurationError,
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

type R2Config = {
  endpoint: URL;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new StorageConfigurationError(`${name} must be configured for R2 storage`);
  }
  return value;
}

function getConfig(): R2Config {
  const accountId = requiredEnv("PACHECKER_R2_ACCOUNT_ID");
  const endpointValue =
    process.env.PACHECKER_R2_ENDPOINT?.trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new StorageConfigurationError("PACHECKER_R2_ENDPOINT must be a valid URL");
  }

  if (endpoint.protocol !== "https:") {
    throw new StorageConfigurationError("PACHECKER_R2_ENDPOINT must use HTTPS");
  }

  return {
    endpoint,
    bucket: requiredEnv("PACHECKER_R2_BUCKET"),
    accessKeyId: requiredEnv("PACHECKER_R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("PACHECKER_R2_SECRET_ACCESS_KEY"),
  };
}

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

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function objectPath(bucket: string, storageKey: string): string {
  return `/${[bucket, ...storageKey.split("/")].map(awsEncode).join("/")}`;
}

function buildSignedHeaders(
  method: "GET" | "PUT" | "DELETE",
  config: R2Config,
  storageKey: string,
  body?: Uint8Array,
): { url: URL; headers: Headers } {
  validateStorageKey(storageKey);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");
  const canonicalUri = objectPath(config.bucket, storageKey);
  const url = new URL(config.endpoint);
  url.pathname = canonicalUri;
  url.search = "";

  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const headers = new Headers({
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  });

  return { url, headers };
}

async function request(
  method: "GET" | "PUT" | "DELETE",
  storageKey: string,
  body?: Uint8Array,
  contentType?: string,
): Promise<Response> {
  const config = getConfig();
  const { url, headers } = buildSignedHeaders(method, config, storageKey, body);
  if (contentType) {
    headers.set("content-type", contentType);
  }

  try {
    return await fetch(url, {
      method,
      headers,
      body: body ? Buffer.from(body) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(
      `R2 request failed before receiving a response: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export async function saveImage(
  bytes: Uint8Array,
  mimeType: string,
  originalFilename?: string | null,
): Promise<StoredImage> {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  validateImageBytes(normalizedMimeType, bytes);

  const storageKey = `images/${randomUUID()}${MIME_EXTENSIONS[normalizedMimeType]}`;
  const response = await request("PUT", storageKey, bytes, normalizedMimeType);
  if (!response.ok) {
    throw new Error(`R2 image upload failed with HTTP ${response.status}`);
  }

  return {
    storageKey,
    originalFilename: normalizeOriginalFilename(originalFilename),
    mimeType: normalizedMimeType,
    sizeBytes: bytes.length,
  };
}

export async function readImage(storageKey: string): Promise<Buffer> {
  const response = await request("GET", storageKey);
  if (response.status === 404) {
    throw new StoredImageNotFoundError();
  }
  if (!response.ok) {
    throw new Error(`R2 image read failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteImage(storageKey: string): Promise<boolean> {
  const response = await request("DELETE", storageKey);
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`R2 image delete failed with HTTP ${response.status}`);
  }
  return true;
}
