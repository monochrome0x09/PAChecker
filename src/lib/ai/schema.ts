import "server-only";

import {
  isAssessmentStatus,
  validateExtraFields,
  type AssessmentStatus,
} from "@/lib/db/assessments";
import { normalizeAiAssessmentDate } from "@/lib/date/normalize-ai-assessment-date";

export type ExtractedAssessmentCore = {
  subjectId?: number;
  subjectName?: string;
  title: string;
  assessmentDate: string;
  description?: string | null;
  materials?: string | null;
  status?: AssessmentStatus;
};

export type StructuredAssessment = {
  core: ExtractedAssessmentCore;
  extraFields: Record<string, unknown>;
};

export class AiSchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSchemaValidationError";
  }
}

// Sent as part of the provider prompt and response_format request. The
// database still performs the same checks before any assessment is saved.
export const STRUCTURED_ASSESSMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["core", "extraFields"],
  properties: {
    core: {
      type: "object",
      additionalProperties: false,
      required: ["title", "assessmentDate"],
      properties: {
        subjectId: { type: "integer", minimum: 1 },
        subjectName: { type: "string" },
        title: { type: "string", minLength: 1 },
        assessmentDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        description: { type: ["string", "null"] },
        materials: { type: ["string", "null"] },
        status: { type: "string", enum: ["pending", "completed"] },
      },
    },
    extraFields: { type: "object" },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalText(
  value: unknown,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AiSchemaValidationError(`${fieldName} must be a string or null`);
  }
  return value.trim() || null;
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new AiSchemaValidationError(`${fieldName} must be a positive integer`);
  }
  return value;
}

function readRequiredText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AiSchemaValidationError(`${fieldName} is required`);
  }
  return value.trim();
}

export function validateStructuredAssessment(value: unknown): StructuredAssessment {
  if (!isRecord(value)) {
    throw new AiSchemaValidationError("AI response must be a JSON object");
  }

  const rawCore = value.core === undefined ? value : value.core;
  if (!isRecord(rawCore)) {
    throw new AiSchemaValidationError("AI response core must be an object");
  }

  const rawAssessmentDate = rawCore.assessmentDate ?? rawCore.date;
  const assessmentDate = normalizeAiAssessmentDate(rawAssessmentDate) ?? "";

  const rawSubjectName = rawCore.subjectName ?? rawCore.subject;
  let subjectName: string | undefined;
  if (rawSubjectName !== undefined && rawSubjectName !== null) {
    subjectName = readRequiredText(rawSubjectName, "subjectName");
  }

  const rawStatus = rawCore.status;
  if (rawStatus !== undefined && !isAssessmentStatus(rawStatus)) {
    throw new AiSchemaValidationError("AI response status must be pending or completed");
  }

  const rawExtraFields = Object.prototype.hasOwnProperty.call(value, "extraFields")
    ? value.extraFields
    : Object.prototype.hasOwnProperty.call(value, "extra_fields")
      ? value.extra_fields
      : {};
  try {
    validateExtraFields(rawExtraFields);
  } catch (error) {
    throw new AiSchemaValidationError(
      error instanceof Error ? error.message : "AI response extraFields is invalid",
    );
  }

  const core: ExtractedAssessmentCore = {
    subjectId: readOptionalPositiveInteger(rawCore.subjectId, "subjectId"),
    subjectName,
    title: readRequiredText(rawCore.title, "title"),
    assessmentDate,
    description: readOptionalText(rawCore.description, "description"),
    materials: readOptionalText(rawCore.materials, "materials"),
    status: rawStatus as AssessmentStatus | undefined,
  };

  return { core, extraFields: rawExtraFields };
}
