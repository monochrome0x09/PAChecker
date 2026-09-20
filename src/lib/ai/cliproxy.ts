import "server-only";

import { Buffer } from "node:buffer";
import {
  AiSchemaValidationError,
  STRUCTURED_ASSESSMENT_SCHEMA,
  validateStructuredAssessment,
  type StructuredAssessment,
} from "./schema";
import type { SupportedImageMimeType } from "@/lib/storage";

export class AiConfigurationError extends Error {
  readonly code = "AI_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export class AiProviderError extends Error {
  readonly code = "AI_PROVIDER_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class AiResponseError extends Error {
  readonly code = "AI_RESPONSE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

type CliProxyConfig = {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
};

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  output_text?: unknown;
};

const SYSTEM_PROMPT = `Extract the assessment information from the supplied image.
Return JSON only with this exact top-level shape:
{
  "core": {
    "subjectId": 1,
    "subjectName": "string",
    "title": "string",
    "assessmentDate": "YYYY-MM-DD",
    "description": "string or null",
    "materials": "string or null",
    "status": "pending or completed"
  },
  "extraFields": {}
}
Use subjectName when the image names a subject. subjectId is optional and should only be emitted when it is explicitly known by the caller. Keep assessmentDate as a real calendar date in YYYY-MM-DD format. If the notice shows only month and day, preserve that visible month and day rather than inventing a different date; the server will apply the current Korean calendar year for user review. Put rubric, points, duration, submission format, team details, scope, and other variable information only in extraFields. Never duplicate fixed core keys inside extraFields. If a fixed value is not visible, omit the optional field and do not guess.`;

function firstNonEmptyEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function getTimeoutMs(): number {
  const configured = firstNonEmptyEnv("CLIPROXY_API_TIMEOUT_MS");
  if (!configured) {
    return 60_000;
  }

  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AiConfigurationError(
      "CLIPROXY_API_TIMEOUT_MS must be a positive integer",
    );
  }
  return parsed;
}

function getConfig(): CliProxyConfig {
  const baseUrl = firstNonEmptyEnv(
    "CLIPROXY_API_URL",
    "CLIPROXYAPI_BASE_URL",
    "CLIPROXY_BASE_URL",
  );
  const model = firstNonEmptyEnv(
    "CLIPROXY_API_MODEL",
    "CLIPROXYAPI_MODEL",
    "CLIPROXY_MODEL",
  );
  if (!baseUrl || !model) {
    throw new AiConfigurationError(
      "AI analysis is not configured: set CLIPROXY_API_URL and CLIPROXY_API_MODEL",
    );
  }

  const endpoint = /\/chat\/completions$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const apiKey = firstNonEmptyEnv(
    "CLIPROXY_API_KEY",
    "CLIPROXYAPI_API_KEY",
    "CLIPROXY_KEY",
  );

  return { endpoint, model, apiKey, timeoutMs: getTimeoutMs() };
}

function contentText(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (typeof part === "object" && part !== null && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new AiResponseError("AI provider returned non-JSON analysis output");
  }
}

function responseContent(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const candidate = payload as ChatCompletionPayload;
  const messageContent = candidate.choices?.[0]?.message?.content;
  return contentText(messageContent) ?? candidate.output_text ?? null;
}

export async function analyzeImageWithCliProxy(
  bytes: Uint8Array,
  mimeType: SupportedImageMimeType,
): Promise<StructuredAssessment> {
  const config = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this assessment notice and return the requested structured JSON.",
              },
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
            ],
          },
        ],
        metadata: { schema: STRUCTURED_ASSESSMENT_SCHEMA },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AiProviderError(`AI provider returned HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiResponseError("AI provider returned invalid JSON");
    }

    const rawContent = responseContent(payload);
    const textContent = contentText(rawContent);
    const parsed = textContent ? parseJsonContent(textContent) : rawContent;
    try {
      return validateStructuredAssessment(parsed);
    } catch (error) {
      if (error instanceof AiSchemaValidationError) {
        throw error;
      }
      throw new AiResponseError("AI provider returned an invalid assessment structure");
    }
  } catch (error) {
    if (
      error instanceof AiConfigurationError ||
      error instanceof AiProviderError ||
      error instanceof AiResponseError ||
      error instanceof AiSchemaValidationError
    ) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiProviderError("AI provider request timed out");
    }
    throw new AiProviderError("AI provider request failed");
  } finally {
    clearTimeout(timeout);
  }
}
