import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { dbBridgeCall, isDatabaseBridgeEnabled } from "./bridge";
import { getPool } from "./pool";

export const ASSESSMENT_STATUSES = ["pending", "completed"] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export type Assessment = {
  id: number;
  subjectId: number;
  subjectName: string;
  title: string;
  assessmentDate: string;
  description: string | null;
  materials: string | null;
  status: AssessmentStatus;
  extraFields: Record<string, unknown>;
};

export type CreateAssessmentInput = {
  subjectId: number;
  title: string;
  assessmentDate: string;
  description?: string | null;
  materials?: string | null;
  status?: AssessmentStatus;
  extraFields?: Record<string, unknown>;
};

export type UpdateAssessmentInput = CreateAssessmentInput;

export class AssessmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentValidationError";
  }
}

export class AssessmentSubjectNotFoundError extends Error {
  constructor() {
    super("Subject not found");
    this.name = "AssessmentSubjectNotFoundError";
  }
}

export class AssessmentReferencedError extends Error {
  constructor() {
    super("Assessment is referenced by dependent records");
    this.name = "AssessmentReferencedError";
  }
}

type AssessmentRow = RowDataPacket & {
  id: number;
  subject_id: number;
  subject_name: string;
  title: string;
  assessment_date: string;
  description: string | null;
  materials: string | null;
  status: string;
  extra_fields: string;
};

type MysqlError = Error & {
  code?: string;
  errno?: number;
};

const ASSESSMENT_SELECT = `
  SELECT
    a.id,
    a.subject_id,
    s.name AS subject_name,
    a.title,
    a.assessment_date,
    a.description,
    a.materials,
    a.status,
    CAST(a.extra_fields AS CHAR) AS extra_fields
  FROM assessments a
  INNER JOIN subjects s ON s.id = a.subject_id
`;

// These aliases cover the API names, database names, and the fixed fields in the
// project data model. Dynamic fields must not shadow any of them.
export const CORE_ASSESSMENT_KEYS: ReadonlySet<string> = new Set(
  [
    "id",
    "subject",
    "subjectId",
    "subject_id",
    "subjectName",
    "subject_name",
    "title",
    "date",
    "assessmentDate",
    "assessment_date",
    "description",
    "materials",
    "status",
    "notificationSettings",
    "notification_settings",
    "sourceImage",
    "source_image",
    "extraFields",
    "extra_fields",
    "createdAt",
    "created_at",
    "updatedAt",
    "updated_at",
  ].map((key) => key.toLowerCase()),
);

function isMysqlError(error: unknown): error is MysqlError {
  return error instanceof Error;
}

function assertValidId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new AssessmentValidationError("id must be a positive integer");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAssessmentStatus(value: unknown): value is AssessmentStatus {
  return (
    typeof value === "string" &&
    (ASSESSMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function validateAssessmentStatus(value: unknown): AssessmentStatus {
  if (!isAssessmentStatus(value)) {
    throw new AssessmentValidationError("status must be pending or completed");
  }
  return value;
}

export function isValidAssessmentDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

export function validateAssessmentDate(value: unknown): string {
  if (!isValidAssessmentDate(value)) {
    throw new AssessmentValidationError(
      "assessmentDate must be a real calendar date in YYYY-MM-DD format",
    );
  }
  return value;
}

export function validateExtraFields(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AssessmentValidationError("extraFields must be an object");
  }

  const invalidKey = Object.keys(value).find((key) =>
    CORE_ASSESSMENT_KEYS.has(key.toLowerCase()),
  );
  if (invalidKey) {
    throw new AssessmentValidationError(
      `extraFields must not contain core assessment key: ${invalidKey}`,
    );
  }
}

function normalizeNullableText(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AssessmentValidationError(`${fieldName} must be a string or null`);
  }
  return value.trim() || null;
}

function serializeExtraFields(extraFields: Record<string, unknown>): string {
  try {
    const serialized = JSON.stringify(extraFields);
    if (typeof serialized !== "string") {
      throw new Error("JSON serialization returned no value");
    }
    return serialized;
  } catch {
    throw new AssessmentValidationError("extraFields must contain JSON-serializable values");
  }
}

export function normalizeAssessmentInput(input: CreateAssessmentInput) {
  if (!isRecord(input)) {
    throw new AssessmentValidationError("Assessment input must be an object");
  }
  if (!Number.isInteger(input.subjectId) || input.subjectId <= 0) {
    throw new AssessmentValidationError("subjectId must be a positive integer");
  }
  if (typeof input.title !== "string") {
    throw new AssessmentValidationError("title is required");
  }

  const title = input.title.trim();
  if (!title) {
    throw new AssessmentValidationError("title is required");
  }

  const assessmentDate = validateAssessmentDate(input.assessmentDate);
  const status =
    input.status === undefined ? "pending" : validateAssessmentStatus(input.status);
  const extraFields = input.extraFields === undefined ? {} : input.extraFields;
  validateExtraFields(extraFields);

  return {
    subjectId: input.subjectId,
    title,
    assessmentDate,
    description: normalizeNullableText(input.description, "description"),
    materials: normalizeNullableText(input.materials, "materials"),
    status,
    extraFields,
    extraFieldsJson: serializeExtraFields(extraFields),
  };
}

function parseExtraFields(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid extra_fields JSON in database");
  }

  validateExtraFields(parsed);
  return parsed;
}

function mapAssessment(row: AssessmentRow): Assessment {
  if (!isAssessmentStatus(row.status)) {
    throw new Error("Invalid assessment status in database");
  }

  return {
    id: row.id,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    title: row.title,
    assessmentDate: row.assessment_date,
    description: row.description,
    materials: row.materials,
    status: row.status,
    extraFields: parseExtraFields(row.extra_fields),
  };
}

function rethrowAssessmentWriteError(error: unknown): never {
  if (isMysqlError(error) && (error.code === "ER_NO_REFERENCED_ROW_2" || error.errno === 1452)) {
    throw new AssessmentSubjectNotFoundError();
  }
  if (
    isMysqlError(error) &&
    (error.code === "ER_ROW_IS_REFERENCED" ||
      error.code === "ER_ROW_IS_REFERENCED_2" ||
      error.errno === 1451)
  ) {
    throw new AssessmentReferencedError();
  }
  throw error;
}

export async function listAssessments(): Promise<Assessment[]> {
  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("assessments.list", {});
    return rows.map((row) => mapAssessment(row as AssessmentRow));
  }

  const [rows] = await getPool().query<AssessmentRow[]>(`
    ${ASSESSMENT_SELECT}
    ORDER BY a.assessment_date ASC, a.id ASC
  `);

  return rows.map(mapAssessment);
}

export async function getAssessment(id: number): Promise<Assessment | null> {
  assertValidId(id);

  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("assessments.get", { id });
    return rows[0] ? mapAssessment(rows[0] as AssessmentRow) : null;
  }

  const [rows] = await getPool().execute<AssessmentRow[]>(
    `
    ${ASSESSMENT_SELECT}
    WHERE a.id = ?
    LIMIT 1
  `,
    [id],
  );

  return rows[0] ? mapAssessment(rows[0]) : null;
}

export async function createAssessment(input: CreateAssessmentInput): Promise<number> {
  const normalized = normalizeAssessmentInput(input);

  if (isDatabaseBridgeEnabled()) {
    try {
      const result = await dbBridgeCall("assessments.create", {
        subjectId: normalized.subjectId,
        title: normalized.title,
        assessmentDate: normalized.assessmentDate,
        description: normalized.description,
        materials: normalized.materials,
        status: normalized.status,
        extraFieldsJson: normalized.extraFieldsJson,
      });
      return result.insertId;
    } catch (error) {
      rethrowAssessmentWriteError(error);
    }
  }

  let result: ResultSetHeader;
  try {
    [result] = await getPool().execute<ResultSetHeader>(
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
  } catch (error) {
    rethrowAssessmentWriteError(error);
  }

  return result.insertId;
}

export async function updateAssessment(
  id: number,
  input: UpdateAssessmentInput,
): Promise<boolean> {
  assertValidId(id);
  const normalized = normalizeAssessmentInput(input);

  if (isDatabaseBridgeEnabled()) {
    let result: Awaited<ReturnType<typeof dbBridgeCall<"assessments.update">>>;
    try {
      result = await dbBridgeCall("assessments.update", {
        id,
        subjectId: normalized.subjectId,
        title: normalized.title,
        assessmentDate: normalized.assessmentDate,
        description: normalized.description,
        materials: normalized.materials,
        status: normalized.status,
        extraFieldsJson: normalized.extraFieldsJson,
      });
    } catch (error) {
      rethrowAssessmentWriteError(error);
    }
    if (result.affectedRows > 0) {
      return true;
    }
    return (await getAssessment(id)) !== null;
  }

  try {
    const [result] = await getPool().execute<ResultSetHeader>(
      `UPDATE assessments
       SET subject_id = ?, title = ?, assessment_date = ?, description = ?, materials = ?, status = ?, extra_fields = ?
       WHERE id = ?`,
      [
        normalized.subjectId,
        normalized.title,
        normalized.assessmentDate,
        normalized.description,
        normalized.materials,
        normalized.status,
        normalized.extraFieldsJson,
        id,
      ],
    );

    if (result.affectedRows > 0) {
      return true;
    }
  } catch (error) {
    rethrowAssessmentWriteError(error);
  }

  // MariaDB may report zero affected rows when a valid row receives identical
  // values. Re-read to distinguish that case from a missing assessment.
  return (await getAssessment(id)) !== null;
}

export async function updateAssessmentStatus(
  id: number,
  status: AssessmentStatus,
): Promise<boolean> {
  assertValidId(id);
  const normalizedStatus = validateAssessmentStatus(status);

  if (isDatabaseBridgeEnabled()) {
    let result: Awaited<ReturnType<typeof dbBridgeCall<"assessments.update-status">>>;
    try {
      result = await dbBridgeCall("assessments.update-status", {
        id,
        status: normalizedStatus,
      });
    } catch (error) {
      rethrowAssessmentWriteError(error);
    }
    if (result.affectedRows > 0) {
      return true;
    }
    return (await getAssessment(id)) !== null;
  }

  try {
    const [result] = await getPool().execute<ResultSetHeader>(
      "UPDATE assessments SET status = ? WHERE id = ?",
      [normalizedStatus, id],
    );

    if (result.affectedRows > 0) {
      return true;
    }
  } catch (error) {
    rethrowAssessmentWriteError(error);
  }

  return (await getAssessment(id)) !== null;
}

export async function deleteAssessment(id: number): Promise<boolean> {
  assertValidId(id);

  if (isDatabaseBridgeEnabled()) {
    try {
      const result = await dbBridgeCall("assessments.delete", { id });
      return result.affectedRows > 0;
    } catch (error) {
      rethrowAssessmentWriteError(error);
    }
  }

  try {
    const [result] = await getPool().execute<ResultSetHeader>(
      "DELETE FROM assessments WHERE id = ?",
      [id],
    );
    return result.affectedRows > 0;
  } catch (error) {
    rethrowAssessmentWriteError(error);
  }
}
