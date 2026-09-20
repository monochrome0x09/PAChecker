export type DbBridgeResultHeader = {
  affectedRows: number;
  insertId: number;
  changedRows: number;
  warningStatus: number;
};

export type DbBridgeSubjectRow = { id: number; name: string };

export type DbBridgeAssessmentRow = {
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

export type DbBridgeSourceImageRow = {
  id: number;
  assessment_id: number | null;
  storage_key: string;
  original_filename: string | null;
  mime_type: string | null;
  created_at: string;
};

export type DbBridgeDraftRow = {
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

export type DbBridgeNotificationSettingRow = {
  id: number;
  assessment_id: number;
  offset_days: number;
  enabled: number;
};

export type DbBridgeDueNotificationRow = DbBridgeNotificationSettingRow & {
  title: string;
  subject_name: string;
  assessment_date: string;
};

type EmptyInput = Record<string, never>;

type AssessmentWriteInput = {
  subjectId: number;
  title: string;
  assessmentDate: string;
  description: string | null;
  materials: string | null;
  status: "pending" | "completed";
  extraFieldsJson: string;
};

export type DbBridgeOperationMap = {
  "subjects.list": { input: EmptyInput; output: DbBridgeSubjectRow[] };
  "subjects.get": { input: { id: number }; output: DbBridgeSubjectRow[] };
  "subjects.create": { input: { name: string }; output: DbBridgeResultHeader };
  "subjects.update": {
    input: { id: number; name: string };
    output: DbBridgeResultHeader;
  };
  "subjects.delete": { input: { id: number }; output: DbBridgeResultHeader };

  "assessments.list": { input: EmptyInput; output: DbBridgeAssessmentRow[] };
  "assessments.get": { input: { id: number }; output: DbBridgeAssessmentRow[] };
  "assessments.create": {
    input: AssessmentWriteInput;
    output: DbBridgeResultHeader;
  };
  "assessments.update": {
    input: AssessmentWriteInput & { id: number };
    output: DbBridgeResultHeader;
  };
  "assessments.update-status": {
    input: { id: number; status: "pending" | "completed" };
    output: DbBridgeResultHeader;
  };
  "assessments.delete": { input: { id: number }; output: DbBridgeResultHeader };

  "source-images.list-for-assessment": {
    input: { assessmentId: number };
    output: Array<Pick<DbBridgeSourceImageRow, "id" | "original_filename" | "mime_type">>;
  };
  "source-images.create": {
    input: {
      storageKey: string;
      originalFilename: string | null;
      mimeType: string;
    };
    output: DbBridgeResultHeader;
  };
  "source-images.get": {
    input: { id: number };
    output: DbBridgeSourceImageRow[];
  };

  "ai-drafts.list": { input: EmptyInput; output: DbBridgeDraftRow[] };
  "ai-drafts.get": { input: { id: number }; output: DbBridgeDraftRow[] };
  "ai-drafts.create": {
    input: {
      sourceImageId: number;
      extractedCoreJson: string;
      extraFieldsJson: string;
    };
    output: DbBridgeResultHeader;
  };
  "ai-drafts.create-failed": {
    input: { sourceImageId: number; errorMessage: string };
    output: DbBridgeResultHeader;
  };
  "ai-drafts.update": {
    input: {
      id: number;
      extractedCoreJson: string;
      extraFieldsJson: string;
    };
    output: DbBridgeResultHeader;
  };
  "ai-drafts.delete-source-if-unlinked": {
    input: { id: number };
    output: DbBridgeResultHeader;
  };
  "ai-drafts.delete": {
    input: { id: number };
    output: { deleted: boolean; sourceImageStorageKey?: string };
  };
  "ai-drafts.confirm": {
    input: {
      id: number;
      subjectId: number;
      title: string;
      assessmentDate: string;
      description: string | null;
      materials: string | null;
      status: "pending" | "completed";
      extraFieldsJson: string;
      notificationOffsets: number[];
    };
    output: {
      assessmentId: number;
      sourceImageId: number;
      subjectName: string;
    } | null;
  };

  "notifications.list-settings": {
    input: { assessmentId: number };
    output: DbBridgeNotificationSettingRow[];
  };
  "notifications.replace-settings": {
    input: { assessmentId: number; offsets: number[] };
    output: null;
  };
  "notifications.list-due": {
    input: { today: string };
    output: DbBridgeDueNotificationRow[];
  };
};

export type DbBridgeOperation = keyof DbBridgeOperationMap;
export type DbBridgeInput<K extends DbBridgeOperation> = DbBridgeOperationMap[K]["input"];
export type DbBridgeOutput<K extends DbBridgeOperation> = DbBridgeOperationMap[K]["output"];

export type DbBridgeRequest = {
  [K in DbBridgeOperation]: { operation: K; input: DbBridgeInput<K> };
}[DbBridgeOperation];

export type DbBridgeWireError = {
  kind: "request" | "database" | "domain";
  message: string;
  name?: string;
  code?: string;
  errno?: number;
};

export type DbBridgeWireResponse =
  | { version: typeof DB_BRIDGE_PROTOCOL_VERSION; ok: true; result: unknown }
  | {
      version: typeof DB_BRIDGE_PROTOCOL_VERSION;
      ok: false;
      error: DbBridgeWireError;
    };
export const DB_BRIDGE_PROTOCOL_VERSION = 1 as const;
