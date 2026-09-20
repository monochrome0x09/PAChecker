import "server-only";
import type { RowDataPacket } from "mysql2";
import { dbBridgeCall, isDatabaseBridgeEnabled } from "./bridge";
import { getPool } from "./pool";

export type AssessmentSourceImage = { id: number; url: string; originalFilename: string | null; mimeType: string | null };
type SourceRow = RowDataPacket & { id: number; original_filename: string | null; mime_type: string | null };

export async function listAssessmentSourceImages(assessmentId: number): Promise<AssessmentSourceImage[]> {
  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("source-images.list-for-assessment", { assessmentId });
    return rows.map((row) => ({ id: row.id, url: `/api/uploads/${row.id}`, originalFilename: row.original_filename, mimeType: row.mime_type }));
  }

  const [rows] = await getPool().execute<SourceRow[]>(
    "SELECT id, original_filename, mime_type FROM source_images WHERE assessment_id = ? ORDER BY id ASC",
    [assessmentId],
  );
  return rows.map((row) => ({ id: row.id, url: `/api/uploads/${row.id}`, originalFilename: row.original_filename, mimeType: row.mime_type }));
}
