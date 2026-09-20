import "server-only";

import type {
  DbBridgeInput,
  DbBridgeOperation,
  DbBridgeOutput,
  DbBridgeWireError,
} from "./bridge-protocol";
import { DB_BRIDGE_PROTOCOL_VERSION } from "./bridge-protocol";

const REQUEST_TIMEOUT_MS = 15_000;

const domainErrorMessages: Record<string, ReadonlySet<string>> = {
  AiDraftStateError: new Set([
    "Confirmed drafts are read-only",
    "Invalid AI draft status",
    "Draft is already confirmed",
    "Draft state changed before confirmation",
  ]),
  SourceImageLinkedError: new Set([
    "Source image is already linked to an assessment",
  ]),
  AssessmentSubjectNotFoundError: new Set(["Subject not found"]),
};

type BridgeConfig = { url: string; token: string };

function getBridgeConfig(): BridgeConfig | null {
  const rawUrl = process.env.DB_BRIDGE_URL?.trim();
  const token = process.env.DB_BRIDGE_TOKEN?.trim();
  const hasUrl = Boolean(rawUrl);
  const hasToken = Boolean(token);
  const requiresBridge =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  if (!hasUrl && !hasToken) {
    if (requiresBridge) {
      throw new Error("DB_BRIDGE_URL and DB_BRIDGE_TOKEN are required in production");
    }
    return null;
  }

  if (!hasUrl || !hasToken) {
    throw new Error("DB_BRIDGE_URL and DB_BRIDGE_TOKEN must be configured together");
  }

  let url: URL;
  try {
    url = new URL(rawUrl!);
  } catch {
    throw new Error("DB_BRIDGE_URL must be an absolute HTTP URL");
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== "/rpc"
  ) {
    throw new Error(
      "DB_BRIDGE_URL must be an absolute HTTP URL ending in /rpc without credentials, query, or fragment",
    );
  }
  if (requiresBridge && url.protocol !== "https:") {
    throw new Error("DB_BRIDGE_URL must use HTTPS in production");
  }

  return { url: url.href, token: token! };
}

export function isDatabaseBridgeEnabled(): boolean {
  return getBridgeConfig() !== null;
}

export class DbBridgeError extends Error {
  readonly code?: string;
  readonly errno?: number;
  readonly remoteName?: string;

  constructor(
    message: string,
    options: { code?: string; errno?: number; remoteName?: string } = {},
  ) {
    super(message);
    this.name = options.remoteName ?? "Error";
    this.code = options.code;
    this.errno = options.errno;
    this.remoteName = options.remoteName;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFromWire(error: unknown): Error {
  if (!isRecord(error) || typeof error.kind !== "string") {
    return new Error("Database bridge request failed");
  }

  if (error.kind === "domain") {
    const name = typeof error.name === "string" ? error.name : "";
    const message = typeof error.message === "string" ? error.message : "";
    if (domainErrorMessages[name]?.has(message)) {
      return new DbBridgeError(message, { remoteName: name });
    }
    return new Error("Database bridge request failed");
  }

  if (error.kind === "database") {
    const code =
      typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : undefined;
    const errno =
      typeof error.errno === "number" &&
      Number.isSafeInteger(error.errno) &&
      error.errno > 0
        ? error.errno
        : undefined;
    return new DbBridgeError("Database operation failed", { code, errno });
  }

  return new Error("Database bridge request failed");
}

export async function dbBridgeCall<K extends DbBridgeOperation>(
  operation: K,
  input: DbBridgeInput<K>,
): Promise<DbBridgeOutput<K>> {
  const config = getBridgeConfig();
  if (!config) {
    throw new Error("Database bridge is not configured");
  }

  let body: string;
  try {
    body = JSON.stringify({
      version: DB_BRIDGE_PROTOCOL_VERSION,
      operation,
      input,
    });
  } catch {
    throw new Error("Database bridge request could not be serialized");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
      signal: controller.signal,
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload)) {
      throw new Error("Database bridge request failed");
    }

    if (payload.version !== DB_BRIDGE_PROTOCOL_VERSION) {
      throw new Error("Database bridge request failed");
    }

    if (payload.ok === false) {
      const wireError = payload.error as DbBridgeWireError | undefined;
      throw errorFromWire(wireError);
    }

    if (!response.ok || payload.ok !== true || !("result" in payload)) {
      throw new Error("Database bridge request failed");
    }

    return payload.result as DbBridgeOutput<K>;
  } catch (error) {
    if (error instanceof DbBridgeError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new Error("Database bridge request timed out");
    }
    if (error instanceof Error && error.message === "Database bridge request failed") {
      throw error;
    }
    throw new Error("Database bridge request failed");
  } finally {
    clearTimeout(timeout);
  }
}
