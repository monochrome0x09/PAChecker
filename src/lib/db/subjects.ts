import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { dbBridgeCall, isDatabaseBridgeEnabled } from "./bridge";
import { getPool } from "./pool";

export type Subject = {
  id: number;
  name: string;
};

type SubjectRow = RowDataPacket & Subject;

export class SubjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubjectValidationError";
  }
}

export class SubjectNameConflictError extends Error {
  constructor() {
    super("A subject with this name already exists");
    this.name = "SubjectNameConflictError";
  }
}

export class SubjectReferencedError extends Error {
  constructor() {
    super("Subject is referenced by assessments");
    this.name = "SubjectReferencedError";
  }
}

type MysqlError = Error & {
  code?: string;
  errno?: number;
};

function isMysqlError(error: unknown): error is MysqlError {
  return error instanceof Error;
}

function assertValidId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new SubjectValidationError("id must be a positive integer");
  }
}

function normalizeName(name: string): string {
  if (typeof name !== "string") {
    throw new SubjectValidationError("name is required");
  }

  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new SubjectValidationError("name is required");
  }
  if (normalizedName.length > 100) {
    throw new SubjectValidationError("name must be 100 characters or fewer");
  }

  return normalizedName;
}

function rethrowSubjectWriteError(error: unknown): never {
  if (isMysqlError(error) && (error.code === "ER_DUP_ENTRY" || error.errno === 1062)) {
    throw new SubjectNameConflictError();
  }
  if (
    isMysqlError(error) &&
    (error.code === "ER_ROW_IS_REFERENCED" ||
      error.code === "ER_ROW_IS_REFERENCED_2" ||
      error.errno === 1451)
  ) {
    throw new SubjectReferencedError();
  }
  throw error;
}

export async function listSubjects(): Promise<Subject[]> {
  if (isDatabaseBridgeEnabled()) {
    return dbBridgeCall("subjects.list", {});
  }

  const [rows] = await getPool().query<SubjectRow[]>(
    "SELECT id, name FROM subjects ORDER BY name ASC",
  );
  return rows;
}

export async function getSubject(id: number): Promise<Subject | null> {
  assertValidId(id);

  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("subjects.get", { id });
    return rows[0] ?? null;
  }

  const [rows] = await getPool().execute<SubjectRow[]>(
    "SELECT id, name FROM subjects WHERE id = ? LIMIT 1",
    [id],
  );
  return rows[0] ?? null;
}

export async function createSubject(name: string): Promise<Subject> {
  const normalizedName = normalizeName(name);

  if (isDatabaseBridgeEnabled()) {
    try {
      const result = await dbBridgeCall("subjects.create", { name: normalizedName });
      return { id: result.insertId, name: normalizedName };
    } catch (error) {
      rethrowSubjectWriteError(error);
    }
  }

  let result: ResultSetHeader;
  try {
    [result] = await getPool().execute<ResultSetHeader>(
      "INSERT INTO subjects (name) VALUES (?)",
      [normalizedName],
    );
  } catch (error) {
    rethrowSubjectWriteError(error);
  }

  return { id: result.insertId, name: normalizedName };
}

export async function updateSubject(id: number, name: string): Promise<Subject | null> {
  assertValidId(id);
  const normalizedName = normalizeName(name);

  if (isDatabaseBridgeEnabled()) {
    try {
      await dbBridgeCall("subjects.update", { id, name: normalizedName });
    } catch (error) {
      rethrowSubjectWriteError(error);
    }
    return getSubject(id);
  }

  try {
    await getPool().execute<ResultSetHeader>(
      "UPDATE subjects SET name = ? WHERE id = ?",
      [normalizedName, id],
    );
  } catch (error) {
    rethrowSubjectWriteError(error);
  }

  return getSubject(id);
}

export async function deleteSubject(id: number): Promise<boolean> {
  assertValidId(id);

  if (isDatabaseBridgeEnabled()) {
    try {
      const result = await dbBridgeCall("subjects.delete", { id });
      return result.affectedRows > 0;
    } catch (error) {
      rethrowSubjectWriteError(error);
    }
  }

  try {
    const [result] = await getPool().execute<ResultSetHeader>(
      "DELETE FROM subjects WHERE id = ?",
      [id],
    );
    return result.affectedRows > 0;
  } catch (error) {
    rethrowSubjectWriteError(error);
  }
}
