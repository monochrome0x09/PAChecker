import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { dbBridgeCall, isDatabaseBridgeEnabled } from "./bridge";
import { getPool } from "./pool";

export type NotificationSetting = { id: number; assessmentId: number; offsetDays: number; enabled: boolean };
export type DueNotification = { id: number; assessmentId: number; offsetDays: number; title: string; subjectName: string; assessmentDate: string };

type SettingRow = RowDataPacket & { id: number; assessment_id: number; offset_days: number; enabled: number };
type DueRow = RowDataPacket & SettingRow & { title: string; subject_name: string; assessment_date: string };

function assertAssessmentId(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid assessment id");
}

export function validateOffsets(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("offsetDays must be an array");
  const offsets = [...new Set(value.map(Number))];
  if (offsets.some((offset) => !Number.isInteger(offset) || offset < 0 || offset > 365)) {
    throw new Error("offsetDays must contain integers from 0 to 365");
  }
  return offsets.sort((a, b) => b - a);
}

export async function listNotificationSettings(assessmentId: number): Promise<NotificationSetting[]> {
  assertAssessmentId(assessmentId);
  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("notifications.list-settings", { assessmentId });
    return rows.map((row) => ({ id: row.id, assessmentId: row.assessment_id, offsetDays: row.offset_days, enabled: Boolean(row.enabled) }));
  }

  const [rows] = await getPool().execute<SettingRow[]>(
    "SELECT id, assessment_id, offset_days, enabled FROM notification_settings WHERE assessment_id = ? ORDER BY offset_days DESC",
    [assessmentId],
  );
  return rows.map((row) => ({ id: row.id, assessmentId: row.assessment_id, offsetDays: row.offset_days, enabled: Boolean(row.enabled) }));
}

export async function replaceNotificationSettings(assessmentId: number, offsets: number[]): Promise<NotificationSetting[]> {
  assertAssessmentId(assessmentId);
  const normalized = validateOffsets(offsets);
  if (isDatabaseBridgeEnabled()) {
    await dbBridgeCall("notifications.replace-settings", { assessmentId, offsets: normalized });
    return listNotificationSettings(assessmentId);
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM notification_settings WHERE assessment_id = ?", [assessmentId]);
    for (const offset of normalized) {
      await connection.execute<ResultSetHeader>(
        "INSERT INTO notification_settings (assessment_id, offset_days, enabled) VALUES (?, ?, TRUE)",
        [assessmentId, offset],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return listNotificationSettings(assessmentId);
}

export async function listDueNotifications(today: string): Promise<DueNotification[]> {
  if (isDatabaseBridgeEnabled()) {
    const rows = await dbBridgeCall("notifications.list-due", { today });
    return rows.map((row) => ({ id: row.id, assessmentId: row.assessment_id, offsetDays: row.offset_days, title: row.title, subjectName: row.subject_name, assessmentDate: row.assessment_date }));
  }

  const [rows] = await getPool().execute<DueRow[]>(
    `SELECT n.id, n.assessment_id, n.offset_days, n.enabled, a.title, a.assessment_date, s.name AS subject_name
     FROM notification_settings n
     JOIN assessments a ON a.id = n.assessment_id
     JOIN subjects s ON s.id = a.subject_id
     WHERE n.enabled = TRUE AND a.status <> 'completed'
       AND DATE_SUB(a.assessment_date, INTERVAL n.offset_days DAY) = ?
     ORDER BY a.assessment_date ASC, a.id ASC`,
    [today],
  );
  return rows.map((row) => ({ id: row.id, assessmentId: row.assessment_id, offsetDays: row.offset_days, title: row.title, subjectName: row.subject_name, assessmentDate: row.assessment_date }));
}
