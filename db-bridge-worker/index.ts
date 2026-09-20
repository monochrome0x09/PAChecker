import { createConnection } from "mysql2/promise";
import type { ResultSetHeader } from "mysql2";
import type {
  DbBridgeAssessmentRow,
  DbBridgeDraftRow,
  DbBridgeDueNotificationRow,
  DbBridgeNotificationSettingRow,
  DbBridgeOperation,
  DbBridgeRequest,
  DbBridgeResultHeader,
  DbBridgeSourceImageRow,
  DbBridgeSubjectRow,
  DbBridgeWireError,
} from "../src/lib/db/bridge-protocol";
import { DB_BRIDGE_PROTOCOL_VERSION } from "../src/lib/db/bridge-protocol";

const MAX_REQUEST_BYTES = 256 * 1024;
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
const OPERATIONS = [
  "subjects.list",
  "subjects.get",
  "subjects.create",
  "subjects.update",
  "subjects.delete",
  "assessments.list",
  "assessments.get",
  "assessments.create",
  "assessments.update",
  "assessments.update-status",
  "assessments.delete",
  "source-images.list-for-assessment",
  "source-images.create",
  "source-images.get",
  "ai-drafts.list",
  "ai-drafts.get",
  "ai-drafts.create",
  "ai-drafts.create-failed",
  "ai-drafts.update",
  "ai-drafts.delete-source-if-unlinked",
  "ai-drafts.delete",
  "ai-drafts.confirm",
  "notifications.list-settings",
  "notifications.replace-settings",
  "notifications.list-due",
] as const satisfies readonly DbBridgeOperation[];

type HyperdriveBinding = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

type WorkerEnvironment = {
  HYPERDRIVE?: HyperdriveBinding;
  DB_BRIDGE_TOKEN?: string;
};

type SqlValue = string | number | boolean | null;
type WorkerConnection = Awaited<ReturnType<typeof createConnection>>;

class RequestValidationError extends Error {}

class WorkerDomainError extends Error {
  constructor(
    readonly domainName: string,
    message: string,
  ) {
    super(message);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse(
    {
      version: DB_BRIDGE_PROTOCOL_VERSION,
      ok: false,
      error: { kind: "request", message } satisfies DbBridgeWireError,
    },
    status,
  );
}

function secureEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function hasValidBearerToken(request: Request, expected: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization) return false;
  const separator = authorization.indexOf(" ");
  if (separator < 1 || authorization.slice(0, separator).toLowerCase() !== "bearer") {
    return false;
  }
  const token = authorization.slice(separator + 1);
  return token.length > 0 && !token.includes(" ") && secureEquals(token, expected);
}

async function readLimitedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) throw new RequestValidationError();
    if (Number(contentLength) > MAX_REQUEST_BYTES) {
      throw new RequestValidationError("body too large");
    }
  }
  if (!request.body) throw new RequestValidationError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestValidationError("body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new RequestValidationError();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new RequestValidationError();
  }
  return value;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported database operation: ${String(value)}`);
}

function validateAssessmentWriteInput(value: unknown, includeId: boolean): void {
  const keys = [
    ...(includeId ? ["id"] : []),
    "subjectId",
    "title",
    "assessmentDate",
    "description",
    "materials",
    "status",
    "extraFieldsJson",
  ];
  const input = exactKeys(value, keys);
  if (
    (includeId && !positiveInteger(input.id)) ||
    !positiveInteger(input.subjectId) ||
    !isString(input.title) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(input.assessmentDate)) ||
    !isNullableString(input.description) ||
    !isNullableString(input.materials) ||
    (input.status !== "pending" && input.status !== "completed") ||
    !isString(input.extraFieldsJson)
  ) {
    throw new RequestValidationError();
  }
}

function validateOperationInput(operation: DbBridgeOperation, value: unknown): void {
  let input: Record<string, unknown>;
  switch (operation) {
    case "subjects.list":
    case "assessments.list":
    case "ai-drafts.list":
      exactKeys(value, []);
      return;
    case "subjects.get":
    case "subjects.delete":
    case "assessments.get":
    case "assessments.delete":
      input = exactKeys(value, ["id"]);
      if (!positiveInteger(input.id)) throw new RequestValidationError();
      return;
    case "ai-drafts.delete-source-if-unlinked":
      input = exactKeys(value, ["id"]);
      if (!positiveSafeInteger(input.id)) throw new RequestValidationError();
      return;
    case "subjects.create":
      input = exactKeys(value, ["name"]);
      if (!isString(input.name)) throw new RequestValidationError();
      return;
    case "subjects.update":
      input = exactKeys(value, ["id", "name"]);
      if (!positiveInteger(input.id) || !isString(input.name)) {
        throw new RequestValidationError();
      }
      return;
    case "assessments.create":
      validateAssessmentWriteInput(value, false);
      return;
    case "assessments.update":
      validateAssessmentWriteInput(value, true);
      return;
    case "assessments.update-status":
      input = exactKeys(value, ["id", "status"]);
      if (
        !positiveInteger(input.id) ||
        (input.status !== "pending" && input.status !== "completed")
      ) {
        throw new RequestValidationError();
      }
      return;
    case "source-images.list-for-assessment":
    case "notifications.list-settings":
      input = exactKeys(value, ["assessmentId"]);
      if (!positiveInteger(input.assessmentId)) throw new RequestValidationError();
      return;
    case "source-images.create":
      input = exactKeys(value, ["storageKey", "originalFilename", "mimeType"]);
      if (
        !isString(input.storageKey) ||
        !isNullableString(input.originalFilename) ||
        !isString(input.mimeType)
      ) {
        throw new RequestValidationError();
      }
      return;
    case "source-images.get":
      input = exactKeys(value, ["id"]);
      if (!positiveSafeInteger(input.id)) throw new RequestValidationError();
      return;
    case "ai-drafts.get":
      input = exactKeys(value, ["id"]);
      if (!positiveSafeInteger(input.id)) throw new RequestValidationError();
      return;
    case "ai-drafts.create":
      input = exactKeys(value, ["sourceImageId", "extractedCoreJson", "extraFieldsJson"]);
      if (
        !positiveSafeInteger(input.sourceImageId) ||
        !isString(input.extractedCoreJson) ||
        !isString(input.extraFieldsJson)
      ) {
        throw new RequestValidationError();
      }
      return;
    case "ai-drafts.create-failed":
      input = exactKeys(value, ["sourceImageId", "errorMessage"]);
      if (
        !positiveSafeInteger(input.sourceImageId) ||
        !isString(input.errorMessage) ||
        input.errorMessage.length > 4000
      ) {
        throw new RequestValidationError();
      }
      return;
    case "ai-drafts.update":
      input = exactKeys(value, ["id", "extractedCoreJson", "extraFieldsJson"]);
      if (
        !positiveSafeInteger(input.id) ||
        !isString(input.extractedCoreJson) ||
        !isString(input.extraFieldsJson)
      ) {
        throw new RequestValidationError();
      }
      return;
    case "ai-drafts.delete":
      input = exactKeys(value, ["id"]);
      if (!positiveSafeInteger(input.id)) throw new RequestValidationError();
      return;
    case "ai-drafts.confirm":
      input = exactKeys(value, [
        "id",
        "subjectId",
        "title",
        "assessmentDate",
        "description",
        "materials",
        "status",
        "extraFieldsJson",
        "notificationOffsets",
      ]);
      if (
        !positiveSafeInteger(input.id) ||
        !positiveInteger(input.subjectId) ||
        !isString(input.title) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(input.assessmentDate)) ||
        !isNullableString(input.description) ||
        !isNullableString(input.materials) ||
        (input.status !== "pending" && input.status !== "completed") ||
        !isString(input.extraFieldsJson) ||
        !Array.isArray(input.notificationOffsets) ||
        input.notificationOffsets.some(
          (offset) => typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 365,
        )
      ) {
        throw new RequestValidationError();
      }
      return;
    case "notifications.replace-settings":
      input = exactKeys(value, ["assessmentId", "offsets"]);
      if (
        !positiveInteger(input.assessmentId) ||
        !Array.isArray(input.offsets) ||
        input.offsets.some(
          (offset) => typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 365,
        )
      ) {
        throw new RequestValidationError();
      }
      return;
    case "notifications.list-due":
      input = exactKeys(value, ["today"]);
      if (!isString(input.today) || !/^\d{4}-\d{2}-\d{2}$/.test(input.today)) {
        throw new RequestValidationError();
      }
      return;
    default:
      return assertNever(operation);
  }
}

function parseRequest(value: unknown): DbBridgeRequest {
  const request = exactKeys(value, ["version", "operation", "input"]);
  if (
    request.version !== DB_BRIDGE_PROTOCOL_VERSION ||
    typeof request.operation !== "string" ||
    !OPERATIONS.includes(request.operation as DbBridgeOperation)
  ) {
    throw new RequestValidationError();
  }
  const operation = request.operation as DbBridgeOperation;
  validateOperationInput(operation, request.input);
  return { operation, input: request.input } as DbBridgeRequest;
}

async function queryRows<T>(
  connection: WorkerConnection,
  sql: string,
  values: readonly SqlValue[] = [],
): Promise<T[]> {
  const [result] = await connection.query(sql, [...values]);
  if (!Array.isArray(result)) throw new Error("Unexpected database result");
  return result as T[];
}

async function queryHeader(
  connection: WorkerConnection,
  sql: string,
  values: readonly SqlValue[] = [],
): Promise<DbBridgeResultHeader> {
  const [result] = await connection.query(sql, [...values]);
  if (Array.isArray(result)) throw new Error("Unexpected database result");
  const header = result as ResultSetHeader;
  return {
    affectedRows: header.affectedRows,
    insertId: header.insertId,
    changedRows: header.changedRows,
    warningStatus: header.warningStatus,
  };
}

async function withConnection<T>(
  env: WorkerEnvironment,
  action: (connection: WorkerConnection) => Promise<T>,
): Promise<T> {
  const hyperdrive = env.HYPERDRIVE;
  if (!hyperdrive) throw new Error("Hyperdrive binding is missing");

  const connection = await createConnection({
    host: hyperdrive.host,
    port: hyperdrive.port,
    user: hyperdrive.user,
    password: hyperdrive.password,
    database: hyperdrive.database,
    disableEval: true,
    dateStrings: true,
  });
  try {
    return await action(connection);
  } finally {
    await connection.end();
  }
}

async function replaceNotificationSettings(
  connection: WorkerConnection,
  assessmentId: number,
  offsets: number[],
): Promise<null> {
  await connection.beginTransaction();
  let completed = false;
  try {
    await queryHeader(
      connection,
      "DELETE FROM notification_settings WHERE assessment_id = ?",
      [assessmentId],
    );
    for (const offset of offsets) {
      await queryHeader(
        connection,
        "INSERT INTO notification_settings (assessment_id, offset_days, enabled) VALUES (?, ?, TRUE)",
        [assessmentId, offset],
      );
    }
    await connection.commit();
    completed = true;
    return null;
  } catch (error) {
    if (!completed) await connection.rollback();
    throw error;
  }
}

async function deleteAiDraft(
  connection: WorkerConnection,
  id: number,
): Promise<{ deleted: boolean; sourceImageStorageKey?: string }> {
  await connection.beginTransaction();
  let completed = false;
  try {
    const rows = await queryRows<{
      source_image_id: number;
      status: string;
      storage_key: string;
      assessment_id: number | null;
    }>(
      connection,
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
      completed = true;
      return { deleted: false };
    }
    if (row.status === "confirmed") {
      throw new WorkerDomainError("AiDraftStateError", "Confirmed drafts are read-only");
    }

    await queryHeader(connection, "DELETE FROM ai_drafts WHERE id = ?", [id]);
    const remaining = await queryRows<{ id: number }>(
      connection,
      "SELECT id FROM ai_drafts WHERE source_image_id = ? LIMIT 1",
      [row.source_image_id],
    );
    let sourceImageStorageKey: string | undefined;
    if (remaining.length === 0 && row.assessment_id === null) {
      const sourceResult = await queryHeader(
        connection,
        "DELETE FROM source_images WHERE id = ? AND assessment_id IS NULL",
        [row.source_image_id],
      );
      if (sourceResult.affectedRows > 0) {
        sourceImageStorageKey = row.storage_key;
      }
    }

    await connection.commit();
    completed = true;
    return { deleted: true, sourceImageStorageKey };
  } catch (error) {
    if (!completed) await connection.rollback();
    throw error;
  }
}

async function confirmAiDraft(
  connection: WorkerConnection,
  input: Extract<DbBridgeRequest, { operation: "ai-drafts.confirm" }>['input'],
): Promise<{ assessmentId: number; sourceImageId: number; subjectName: string } | null> {
  await connection.beginTransaction();
  let completed = false;
  try {
    const draftRows = await queryRows<DbBridgeDraftRow>(
      connection,
      `${DRAFT_SELECT}\n      WHERE d.id = ?\n      FOR UPDATE`,
      [input.id],
    );
    const draft = draftRows[0];
    if (!draft) {
      await connection.rollback();
      completed = true;
      return null;
    }
    if (
      draft.status !== "pending" &&
      draft.status !== "ready" &&
      draft.status !== "failed" &&
      draft.status !== "confirmed"
    ) {
      throw new WorkerDomainError("AiDraftStateError", "Invalid AI draft status");
    }
    if (draft.status === "confirmed") {
      throw new WorkerDomainError("AiDraftStateError", "Draft is already confirmed");
    }
    if (draft.source_assessment_id !== null) {
      throw new WorkerDomainError(
        "SourceImageLinkedError",
        "Source image is already linked to an assessment",
      );
    }

    const subjectRows = await queryRows<DbBridgeSubjectRow>(
      connection,
      "SELECT id, name FROM subjects WHERE id = ? LIMIT 1",
      [input.subjectId],
    );
    const subject = subjectRows[0];
    if (!subject) {
      throw new WorkerDomainError("AssessmentSubjectNotFoundError", "Subject not found");
    }

    const assessmentResult = await queryHeader(
      connection,
      `INSERT INTO assessments
        (subject_id, title, assessment_date, description, materials, status, extra_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.subjectId,
        input.title,
        input.assessmentDate,
        input.description,
        input.materials,
        input.status,
        input.extraFieldsJson,
      ],
    );
    const assessmentId = assessmentResult.insertId;

    for (const offset of input.notificationOffsets) {
      await queryHeader(
        connection,
        `INSERT INTO notification_settings (assessment_id, offset_days, enabled)
         VALUES (?, ?, TRUE)`,
        [assessmentId, offset],
      );
    }

    const sourceResult = await queryHeader(
      connection,
      `UPDATE source_images
       SET assessment_id = ?
       WHERE id = ? AND assessment_id IS NULL`,
      [assessmentId, draft.source_image_id],
    );
    if (sourceResult.affectedRows !== 1) {
      throw new WorkerDomainError(
        "SourceImageLinkedError",
        "Source image is already linked to an assessment",
      );
    }

    const draftResult = await queryHeader(
      connection,
      `UPDATE ai_drafts
       SET status = 'confirmed', error_message = NULL
       WHERE id = ? AND status IN ('pending', 'ready', 'failed')`,
      [input.id],
    );
    if (draftResult.affectedRows !== 1) {
      throw new WorkerDomainError(
        "AiDraftStateError",
        "Draft state changed before confirmation",
      );
    }

    await connection.commit();
    completed = true;
    return {
      assessmentId,
      sourceImageId: draft.source_image_id,
      subjectName: subject.name,
    };
  } catch (error) {
    if (!completed) await connection.rollback();
    throw error;
  }
}

async function dispatch(
  connection: WorkerConnection,
  request: DbBridgeRequest,
): Promise<unknown> {
  switch (request.operation) {
    case "subjects.list":
      return queryRows<DbBridgeSubjectRow>(
        connection,
        "SELECT id, name FROM subjects ORDER BY name ASC",
      );
    case "subjects.get":
      return queryRows<DbBridgeSubjectRow>(
        connection,
        "SELECT id, name FROM subjects WHERE id = ? LIMIT 1",
        [request.input.id],
      );
    case "subjects.create":
      return queryHeader(connection, "INSERT INTO subjects (name) VALUES (?)", [request.input.name]);
    case "subjects.update":
      return queryHeader(
        connection,
        "UPDATE subjects SET name = ? WHERE id = ?",
        [request.input.name, request.input.id],
      );
    case "subjects.delete":
      return queryHeader(connection, "DELETE FROM subjects WHERE id = ?", [request.input.id]);

    case "assessments.list":
      return queryRows<DbBridgeAssessmentRow>(
        connection,
        `${ASSESSMENT_SELECT}\n  ORDER BY a.assessment_date ASC, a.id ASC`,
      );
    case "assessments.get":
      return queryRows<DbBridgeAssessmentRow>(
        connection,
        `${ASSESSMENT_SELECT}\n  WHERE a.id = ?\n  LIMIT 1`,
        [request.input.id],
      );
    case "assessments.create": {
      const input = request.input;
      return queryHeader(
        connection,
        `INSERT INTO assessments
          (subject_id, title, assessment_date, description, materials, status, extra_fields)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.subjectId,
          input.title,
          input.assessmentDate,
          input.description,
          input.materials,
          input.status,
          input.extraFieldsJson,
        ],
      );
    }
    case "assessments.update": {
      const input = request.input;
      return queryHeader(
        connection,
        `UPDATE assessments
         SET subject_id = ?, title = ?, assessment_date = ?, description = ?, materials = ?, status = ?, extra_fields = ?
         WHERE id = ?`,
        [
          input.subjectId,
          input.title,
          input.assessmentDate,
          input.description,
          input.materials,
          input.status,
          input.extraFieldsJson,
          input.id,
        ],
      );
    }
    case "assessments.update-status":
      return queryHeader(
        connection,
        "UPDATE assessments SET status = ? WHERE id = ?",
        [request.input.status, request.input.id],
      );
    case "assessments.delete":
      return queryHeader(connection, "DELETE FROM assessments WHERE id = ?", [request.input.id]);

    case "source-images.list-for-assessment":
      return queryRows<Pick<DbBridgeSourceImageRow, "id" | "original_filename" | "mime_type">>(
        connection,
        "SELECT id, original_filename, mime_type FROM source_images WHERE assessment_id = ? ORDER BY id ASC",
        [request.input.assessmentId],
      );
    case "source-images.create":
      return queryHeader(
        connection,
        `INSERT INTO source_images (storage_key, original_filename, mime_type)
         VALUES (?, ?, ?)`,
        [request.input.storageKey, request.input.originalFilename, request.input.mimeType],
      );
    case "source-images.get":
      return queryRows<DbBridgeSourceImageRow>(
        connection,
        `SELECT id, assessment_id, storage_key, original_filename, mime_type, created_at
         FROM source_images
         WHERE id = ?
         LIMIT 1`,
        [request.input.id],
      );

    case "ai-drafts.list":
      return queryRows<DbBridgeDraftRow>(
        connection,
        `${DRAFT_SELECT}\n  ORDER BY d.id DESC`,
      );
    case "ai-drafts.get":
      return queryRows<DbBridgeDraftRow>(
        connection,
        `${DRAFT_SELECT}\n  WHERE d.id = ?\n  LIMIT 1`,
        [request.input.id],
      );
    case "ai-drafts.create":
      return queryHeader(
        connection,
        `INSERT INTO ai_drafts
          (source_image_id, extracted_core, extracted_extra_fields, status, error_message)
         VALUES (?, ?, ?, 'ready', NULL)`,
        [
          request.input.sourceImageId,
          request.input.extractedCoreJson,
          request.input.extraFieldsJson,
        ],
      );
    case "ai-drafts.create-failed":
      return queryHeader(
        connection,
        `INSERT INTO ai_drafts
          (source_image_id, extracted_core, extracted_extra_fields, status, error_message)
         VALUES (?, '{}', '{}', 'failed', ?)`,
        [request.input.sourceImageId, request.input.errorMessage],
      );
    case "ai-drafts.update":
      return queryHeader(
        connection,
        `UPDATE ai_drafts
         SET extracted_core = ?, extracted_extra_fields = ?, status = 'ready', error_message = NULL
         WHERE id = ? AND status IN ('pending', 'ready', 'failed')`,
        [request.input.extractedCoreJson, request.input.extraFieldsJson, request.input.id],
      );
    case "ai-drafts.delete-source-if-unlinked":
      return queryHeader(
        connection,
        "DELETE FROM source_images WHERE id = ? AND assessment_id IS NULL",
        [request.input.id],
      );
    case "ai-drafts.delete":
      return deleteAiDraft(connection, request.input.id);
    case "ai-drafts.confirm":
      return confirmAiDraft(connection, request.input);

    case "notifications.list-settings":
      return queryRows<DbBridgeNotificationSettingRow>(
        connection,
        "SELECT id, assessment_id, offset_days, enabled FROM notification_settings WHERE assessment_id = ? ORDER BY offset_days DESC",
        [request.input.assessmentId],
      );
    case "notifications.replace-settings":
      return replaceNotificationSettings(
        connection,
        request.input.assessmentId,
        request.input.offsets,
      );
    case "notifications.list-due":
      return queryRows<DbBridgeDueNotificationRow>(
        connection,
        `SELECT n.id, n.assessment_id, n.offset_days, n.enabled, a.title, a.assessment_date, s.name AS subject_name
         FROM notification_settings n
         JOIN assessments a ON a.id = n.assessment_id
         JOIN subjects s ON s.id = a.subject_id
         WHERE n.enabled = TRUE AND a.status <> 'completed'
           AND DATE_SUB(a.assessment_date, INTERVAL n.offset_days DAY) = ?
         ORDER BY a.assessment_date ASC, a.id ASC`,
        [request.input.today],
      );
    default:
      return assertNever(request);
  }
}

function serializeWorkerError(error: unknown): DbBridgeWireError {
  if (error instanceof WorkerDomainError) {
    return {
      kind: "domain",
      name: error.domainName,
      message: error.message,
    };
  }

  const dbError = isRecord(error) ? error : {};
  const code =
    typeof dbError.code === "string" && /^[A-Z0-9_]{1,64}$/.test(dbError.code)
      ? dbError.code
      : undefined;
  const errno =
    typeof dbError.errno === "number" &&
    Number.isSafeInteger(dbError.errno) &&
    dbError.errno > 0
      ? dbError.errno
      : undefined;
  return {
    kind: "database",
    message: "Database operation failed",
    ...(code ? { code } : {}),
    ...(errno ? { errno } : {}),
  };
}

async function handleRequest(request: Request, env: WorkerEnvironment): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/rpc") return errorResponse(404, "Not found");
  if (request.method !== "POST") return errorResponse(405, "Method not allowed");

  const expectedToken = env.DB_BRIDGE_TOKEN;
  if (!expectedToken) return errorResponse(503, "Database bridge is unavailable");
  if (!hasValidBearerToken(request, expectedToken)) {
    return errorResponse(401, "Unauthorized");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse(415, "Unsupported media type");
  }

  let bridgeRequest: DbBridgeRequest;
  try {
    const body = await readLimitedBody(request);
    bridgeRequest = parseRequest(JSON.parse(body) as unknown);
  } catch (error) {
    if (error instanceof RequestValidationError && error.message === "body too large") {
      return errorResponse(413, "Request body too large");
    }
    return errorResponse(400, "Invalid request");
  }

  try {
    const result = await withConnection(env, (connection) => dispatch(connection, bridgeRequest));
    return jsonResponse({ version: DB_BRIDGE_PROTOCOL_VERSION, ok: true, result });
  } catch (error) {
    return jsonResponse(
      {
        version: DB_BRIDGE_PROTOCOL_VERSION,
        ok: false,
        error: serializeWorkerError(error),
      },
      500,
    );
  }
}

const worker = {
  fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    return handleRequest(request, env);
  },
};

export default worker;
