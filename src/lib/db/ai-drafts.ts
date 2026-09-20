import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  AssessmentSubjectNotFoundError,
  isAssessmentStatus,
  isValidAssessmentDate,
  validateExtraFields,
  type Assessment,
  type AssessmentStatus,
} from "./assessments";
import { dbBridgeCall, DbBridgeError, isDatabaseBridgeEnabled } from "./bridge";
import { getPool } from "./pool";
import {
  validateStructuredAssessment,
  type ExtractedAssessmentCore,
  type StructuredAssessment,
} from "@/lib/ai/schema";

export type AiDraftStatus = "pending" | "ready" | "failed" | "confirmed";

export type SourceImage = {
  id: number;
  assessmentId: number | null;
  storageKey: string;
  originalFilename: string | null;
  mimeType: string | null;
  createdAt: string;
};

export type AiDraft = {
  id: number;
  sourceImageId: number;
  status: AiDraftStatus;
  extractedCore: ExtractedAssessmentCore | null;
  extraFields: Record<string, unknown>;
  errorMessage?: string;
  sourceImage: SourceImage;
};

export type CreateSourceImageInput = {
  storageKey: string;
  originalFilename: string | null;
  mimeType: string;
};

export type ReviewAssessmentInput = {
  subjectId: number;
  title: string;
  assessmentDate: string;
  description?: string | null;
  materials?: string | null;
  status?: AssessmentStatus;
  extraFields?: Record<string, unknown>;
  notificationOffsets?: number[];
};

export type DeleteAiDraftResult = {
  deleted: boolean;
  sourceImageStorageKey?: string;
};

export type ConfirmAiDraftResult = {
  assessmentId: number;
  sourceImageId: number;
  assessment: Assessment;
};

export class AiDraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiDraftValidationError";
  }
}

export class SourceImageNotFoundError extends Error {
  constructor() {
    super("Source image not found");
    this.name = "SourceImageNotFoundError";
  }
}

export class AiDraftStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiDraftStateError";
  }
}

export class SourceImageLinkedError extends Error {
  constructor() {
    super("Source image is already linked to an assessment");
    this.name = "SourceImageLinkedError";
  }
}

type SourceImageRow = RowDataPacket & {
  id: number;
  assessment_id: number | null;
  storage_key: string;
  original_filename: string | null;
  mime_type: string | null;
  created_at: string;
};

type DraftRow = RowDataPacket & {
  id: number;
  source_image_id: number;
  source_image_row_id: number;
  status: string;
  extracted_core: string;
  extracted_extra_fields: string;
  error_message: string | null;
  source_assessment_id: number | null;
  storage_key: string;
  original_filename: string | null;
  mime_type: string | null;
  source_created_at: string;
};

type ConfirmRow = RowDataPacket & DraftRow;
type SubjectRow = RowDataPacket & { id: number; name: string };

const DRAFT_SELECT = `
  SELECT
    d.id,
    d.source_image_id,
    d.status,
    CAST(d.extracted_core AS CHAR) AS extracted_core,
    CAST(d.extracted_extra_fields AS CHAR) AS extracted_extra_fields,
    d.error_message,
    si.id AS source_image_row_id,
    si.assessment_id AS source_assessment_id,
    si.storage_key,
    si.original_filename,
    si.mime_type,
    si.created_at AS source_created_at
  FROM ai_drafts d
  INNER JOIN source_images si ON si.id = d.source_image_id
`;

function assertValidId(id: number, fieldName: string): void {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AiDraftValidationError(`${fieldName} must be a positive integer`);
  }
}

function isDraftStatus(value: unknown): value is AiDraftStatus {
  return (
    value === "pending" ||
    value === "ready" ||
    value === "failed" ||
    value === "confirmed"
  );
}

function normalizeText(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AiDraftValidationError(`${fieldName} must be a string or null`);
  }
  return value.trim() || null;
}

function serializeJson(value: unknown, fieldName: string): string {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      throw new Error("JSON serialization returned no value");
    }
    return serialized;
  } catch {
    throw new AiDraftValidationError(`${fieldName} must contain JSON-serializable values`);
  }
}

function normalizeNotificationOffsets(value: unknown): number[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AiDraftValidationError("notificationOffsets must be an array");
  }

  const offsets = [...new Set(value)];
  if (
    offsets.some(
      (offset) =>
        typeof offset !== "number" ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > 365,
    )
  ) {
    throw new AiDraftValidationError(
      "notificationOffsets must contain integers from 0 to 365",
    );
  }
  return offsets.sort((left, right) => right - left);
}

function normalizeReviewInput(input: ReviewAssessmentInput) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AiDraftValidationError("Reviewed assessment must be an object");
  }
  if (!Number.isSafeInteger(input.subjectId) || input.subjectId <= 0) {
    throw new AiDraftValidationError("subjectId must be a positive integer");
  }
  if (typeof input.title !== "string" || !input.title.trim()) {
    throw new AiDraftValidationError("title is required");
  }
  const title = input.title.trim();
  if (title.length > 200) {
    throw new AiDraftValidationError("title must be 200 characters or fewer");
  }
  if (!isValidAssessmentDate(input.assessmentDate)) {
    throw new AiDraftValidationError(
      "assessmentDate must be a real calendar date in YYYY-MM-DD format",
    );
  }

  const status = input.status === undefined ? "pending" : input.status;
  if (!isAssessmentStatus(status)) {
    throw new AiDraftValidationError("status must be pending or completed");
  }
  const extraFields = input.extraFields === undefined ? {} : input.extraFields;
  try {
    validateExtraFields(extraFields);
  } catch (error) {
    throw new AiDraftValidationError(
      error instanceof Error ? error.message : "extraFields is invalid",
    );
  }

  const description = normalizeText(input.description, "description");
  const materials = normalizeText(input.materials, "materials");
  const notificationOffsets = normalizeNotificationOffsets(input.notificationOffsets);
  return {
    subjectId: input.subjectId,
    title,
    assessmentDate: input.assessmentDate,
    description,
    materials,
    status,
    extraFields,
    extraFieldsJson: serializeJson(extraFields, "extraFields"),
    notificationOffsets,
  };
}

function parseJson(raw: string, fieldName: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ${fieldName} JSON in database`);
  }
}

function mapSourceImage(row: SourceImageRow | DraftRow): SourceImage {
  return {
    id: "source_image_row_id" in row ? row.source_image_row_id : row.id,
    assessmentId: "source_assessment_id" in row ? row.source_assessment_id : row.assessment_id,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    createdAt: "source_created_at" in row ? row.source_created_at : row.created_at,
  };
}

function mapDraft(row: DraftRow): AiDraft {
  if (!isDraftStatus(row.status)) {
    throw new Error("Invalid AI draft status in database");
  }

  const extraFieldsRaw = parseJson(row.extracted_extra_fields, "extracted_extra_fields");
  validateExtraFields(extraFieldsRaw);

  let extractedCore: ExtractedAssessmentCore | null = null;
  if (row.status !== "failed") {
    const coreRaw = parseJson(row.extracted_core, "extracted_core");
    extractedCore = validateStructuredAssessment({
      core: coreRaw,
      extraFields: extraFieldsRaw,
    }).core;
  }

  return {
    id: row.id,
    sourceImageId: row.source_image_id,
    status: row.status,
    extractedCore,
    extraFields: extraFieldsRaw,
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    sourceImage: mapSourceImage(row),
  };
}

function rethrowAiDraftBridgeError(error: unknown): never {
  if (error instanceof DbBridgeError) {
    if (error.remoteName === "AiDraftStateError") {
      throw new AiDraftStateError(error.message);
    }
    if (error.remoteName === "SourceImageLinkedError") {
      throw new SourceImageLinkedError();
    }
    if (error.remoteName === "AssessmentSubjectNotFoundError") {
      throw new AssessmentSubjectNotFoundError();
    }
  }
  throw error;
}

export async function createSourceImage(input: CreateSourceImageInput): Promise<SourceImage> {
  if (!input.storageKey.trim()) {
    throw new AiDraftValidationError("storageKey is required");
  }
  if (!input.mimeType.trim()) {
    throw new AiDraftValidationError("mimeType is required");
  }

  let insertId: number;
  if (isDatabaseBridgeEnabled()) {
    const result = await dbBridgeCall("source-images.create", {
      storageKey: input.storageKey,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
    });
    insertId = result.insertId;
  } else {
    const [result] = await getPool().execute<ResultSetHeader>(
      `INSERT INTO source_images (storage_key, original_filename, mime_type)
       VALUES (?, ?, ?)`,
      [input.storageKey, input.originalFilename, input.mimeType],
    );
    insertId = result.insertId;
  }
  const sourceImage = await getSourceImage(insertId);
  if (!sourceImage) {
    throw new Error("Created source image was not found");
  }
  return sourceImage;
}

export async function getSourceImage(id: number): Promise<SourceImage | null> {
  assertValidId(id, "sourceImageId");
  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("source-images.get", { id });
    return rows[0] ? mapSourceImage(rows[0] as SourceImageRow) : null;
  }

  const [rows] = await getPool().execute<SourceImageRow[]>(
    `SELECT id, assessment_id, storage_key, original_filename, mime_type, created_at
     FROM source_images
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  return rows[0] ? mapSourceImage(rows[0]) : null;
}

export async function listAiDrafts(): Promise<AiDraft[]> {
  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("ai-drafts.list", {});
    return rows.map((row) => mapDraft(row as DraftRow));
  }

  const [rows] = await getPool().query<DraftRow[]>(`
    ${DRAFT_SELECT}
    ORDER BY d.id DESC
  `);
  return rows.map(mapDraft);
}

export async function getAiDraft(id: number): Promise<AiDraft | null> {
  assertValidId(id, "draftId");
  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("ai-drafts.get", { id });
    return rows[0] ? mapDraft(rows[0] as DraftRow) : null;
  }

  const [rows] = await getPool().execute<DraftRow[]>(
    `
    ${DRAFT_SELECT}
    WHERE d.id = ?
    LIMIT 1
  `,
    [id],
  );
  return rows[0] ? mapDraft(rows[0]) : null;
}

export async function createAiDraft(
  sourceImageId: number,
  structured: StructuredAssessment,
): Promise<AiDraft> {
  assertValidId(sourceImageId, "sourceImageId");
  const sourceImage = await getSourceImage(sourceImageId);
  if (!sourceImage) {
    throw new SourceImageNotFoundError();
  }
  const validated = validateStructuredAssessment(structured);

  const extractedCoreJson = serializeJson(validated.core, "extractedCore");
  const extraFieldsJson = serializeJson(validated.extraFields, "extraFields");
  let insertId: number;
  if (isDatabaseBridgeEnabled()) {
    const result = await dbBridgeCall("ai-drafts.create", {
      sourceImageId,
      extractedCoreJson,
      extraFieldsJson,
    });
    insertId = result.insertId;
  } else {
    const [result] = await getPool().execute<ResultSetHeader>(
      `INSERT INTO ai_drafts
        (source_image_id, extracted_core, extracted_extra_fields, status, error_message)
       VALUES (?, ?, ?, 'ready', NULL)`,
      [sourceImageId, extractedCoreJson, extraFieldsJson],
    );
    insertId = result.insertId;
  }

  const draft = await getAiDraft(insertId);
  if (!draft) {
    throw new Error("Created AI draft was not found");
  }
  return draft;
}

export async function createFailedAiDraft(
  sourceImageId: number,
  errorMessage: string,
): Promise<AiDraft> {
  assertValidId(sourceImageId, "sourceImageId");
  const sourceImage = await getSourceImage(sourceImageId);
  if (!sourceImage) {
    throw new SourceImageNotFoundError();
  }

  const normalizedMessage = errorMessage.trim().slice(0, 4000) || "AI analysis failed";
  let insertId: number;
  if (isDatabaseBridgeEnabled()) {
    const result = await dbBridgeCall("ai-drafts.create-failed", {
      sourceImageId,
      errorMessage: normalizedMessage,
    });
    insertId = result.insertId;
  } else {
    const [result] = await getPool().execute<ResultSetHeader>(
      `INSERT INTO ai_drafts
        (source_image_id, extracted_core, extracted_extra_fields, status, error_message)
       VALUES (?, '{}', '{}', 'failed', ?)`,
      [sourceImageId, normalizedMessage],
    );
    insertId = result.insertId;
  }

  const draft = await getAiDraft(insertId);
  if (!draft) {
    throw new Error("Created failed AI draft was not found");
  }
  return draft;
}

export async function updateAiDraft(
  id: number,
  structured: StructuredAssessment,
): Promise<AiDraft | null> {
  assertValidId(id, "draftId");
  const validated = validateStructuredAssessment(structured);
  const extractedCoreJson = serializeJson(validated.core, "extractedCore");
  const extraFieldsJson = serializeJson(validated.extraFields, "extraFields");
  let affectedRows: number;
  if (isDatabaseBridgeEnabled()) {
    const result = await dbBridgeCall("ai-drafts.update", {
      id,
      extractedCoreJson,
      extraFieldsJson,
    });
    affectedRows = result.affectedRows;
  } else {
    const [result] = await getPool().execute<ResultSetHeader>(
      `UPDATE ai_drafts
       SET extracted_core = ?, extracted_extra_fields = ?, status = 'ready', error_message = NULL
       WHERE id = ? AND status IN ('pending', 'ready', 'failed')`,
      [extractedCoreJson, extraFieldsJson, id],
    );
    affectedRows = result.affectedRows;
  }

  if (affectedRows === 0) {
    const current = await getAiDraft(id);
    if (!current) {
      return null;
    }
    if (current.status === "confirmed") {
      throw new AiDraftStateError("Confirmed drafts are read-only");
    }
  }
  return getAiDraft(id);
}

export async function deleteSourceImageIfUnlinked(id: number): Promise<boolean> {
  assertValidId(id, "sourceImageId");
  if (isDatabaseBridgeEnabled()) {
    const result = await dbBridgeCall("ai-drafts.delete-source-if-unlinked", { id });
    return result.affectedRows > 0;
  }

  const [result] = await getPool().execute<ResultSetHeader>(
    "DELETE FROM source_images WHERE id = ? AND assessment_id IS NULL",
    [id],
  );
  return result.affectedRows > 0;
}

export async function deleteAiDraft(id: number): Promise<DeleteAiDraftResult> {
  assertValidId(id, "draftId");
  if (isDatabaseBridgeEnabled()) {
    try {
      return await dbBridgeCall("ai-drafts.delete", { id });
    } catch (error) {
      rethrowAiDraftBridgeError(error);
    }
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<
      (RowDataPacket & {
        source_image_id: number;
        status: string;
        storage_key: string;
        assessment_id: number | null;
      })[]
    >(
      `SELECT d.source_image_id, d.status, si.storage_key, si.assessment_id
       FROM ai_drafts d
       INNER JOIN source_images si ON si.id = d.source_image_id
       WHERE d.id = ?
       FOR UPDATE`,
      [id],
    );
    const row = rows[0];
    if (!row) {
      await connection.rollback();
      return { deleted: false };
    }
    if (row.status === "confirmed") {
      throw new AiDraftStateError("Confirmed drafts are read-only");
    }

    await connection.execute("DELETE FROM ai_drafts WHERE id = ?", [id]);
    const [remaining] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM ai_drafts WHERE source_image_id = ? LIMIT 1",
      [row.source_image_id],
    );
    let sourceImageStorageKey: string | undefined;
    if (remaining.length === 0 && row.assessment_id === null) {
      const [sourceResult] = await connection.execute<ResultSetHeader>(
        "DELETE FROM source_images WHERE id = ? AND assessment_id IS NULL",
        [row.source_image_id],
      );
      if (sourceResult.affectedRows > 0) {
        sourceImageStorageKey = row.storage_key;
      }
    }

    await connection.commit();
    return { deleted: true, sourceImageStorageKey };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function confirmAiDraft(
  id: number,
  input: ReviewAssessmentInput,
): Promise<ConfirmAiDraftResult | null> {
  assertValidId(id, "draftId");
  const normalized = normalizeReviewInput(input);
  if (isDatabaseBridgeEnabled()) {
    try {
      const result = await dbBridgeCall("ai-drafts.confirm", {
        id,
        subjectId: normalized.subjectId,
        title: normalized.title,
        assessmentDate: normalized.assessmentDate,
        description: normalized.description,
        materials: normalized.materials,
        status: normalized.status,
        extraFieldsJson: normalized.extraFieldsJson,
        notificationOffsets: normalized.notificationOffsets,
      });
      if (!result) return null;

      const assessment: Assessment = {
        id: result.assessmentId,
        subjectId: normalized.subjectId,
        subjectName: result.subjectName,
        title: normalized.title,
        assessmentDate: normalized.assessmentDate,
        description: normalized.description,
        materials: normalized.materials,
        status: normalized.status,
        extraFields: normalized.extraFields,
      };
      return {
        assessmentId: result.assessmentId,
        sourceImageId: result.sourceImageId,
        assessment,
      };
    } catch (error) {
      rethrowAiDraftBridgeError(error);
    }
  }

  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const [draftRows] = await connection.execute<ConfirmRow[]>(
      `
      ${DRAFT_SELECT}
      WHERE d.id = ?
      FOR UPDATE
    `,
      [id],
    );
    const draft = draftRows[0];
    if (!draft) {
      await connection.rollback();
      return null;
    }
    if (!isDraftStatus(draft.status)) {
      throw new AiDraftStateError("Invalid AI draft status");
    }
    if (draft.status === "confirmed") {
      throw new AiDraftStateError("Draft is already confirmed");
    }
    if (draft.source_assessment_id !== null) {
      throw new SourceImageLinkedError();
    }

    const [subjectRows] = await connection.execute<SubjectRow[]>(
      "SELECT id, name FROM subjects WHERE id = ? LIMIT 1",
      [normalized.subjectId],
    );
    const subject = subjectRows[0];
    if (!subject) {
      throw new AssessmentSubjectNotFoundError();
    }

    const [assessmentResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO assessments
        (subject_id, title, assessment_date, description, materials, status, extra_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        normalized.subjectId,
        normalized.title,
        normalized.assessmentDate,
        normalized.description,
        normalized.materials,
        normalized.status,
        normalized.extraFieldsJson,
      ],
    );
    const assessmentId = assessmentResult.insertId;

    for (const offset of normalized.notificationOffsets) {
      await connection.execute(
        `INSERT INTO notification_settings (assessment_id, offset_days, enabled)
         VALUES (?, ?, TRUE)`,
        [assessmentId, offset],
      );
    }

    const [sourceResult] = await connection.execute<ResultSetHeader>(
      `UPDATE source_images
       SET assessment_id = ?
       WHERE id = ? AND assessment_id IS NULL`,
      [assessmentId, draft.source_image_id],
    );
    if (sourceResult.affectedRows !== 1) {
      throw new SourceImageLinkedError();
    }

    const [draftResult] = await connection.execute<ResultSetHeader>(
      `UPDATE ai_drafts
       SET status = 'confirmed', error_message = NULL
       WHERE id = ? AND status IN ('pending', 'ready', 'failed')`,
      [id],
    );
    if (draftResult.affectedRows !== 1) {
      throw new AiDraftStateError("Draft state changed before confirmation");
    }

    await connection.commit();
    const assessment: Assessment = {
      id: assessmentId,
      subjectId: normalized.subjectId,
      subjectName: subject.name,
      title: normalized.title,
      assessmentDate: normalized.assessmentDate,
      description: normalized.description,
      materials: normalized.materials,
      status: normalized.status,
      extraFields: normalized.extraFields,
    };
    return {
      assessmentId,
      sourceImageId: draft.source_image_id,
      assessment,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
