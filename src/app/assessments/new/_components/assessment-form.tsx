"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./form.module.css";

type FormMode = "create" | "edit";
type AssessmentStatus = "pending" | "completed";
type SaveStage = "assessment" | "notifications" | null;

type Subject = {
  id: number;
  name: string;
};

type Assessment = {
  id: number;
  subjectId: number;
  title: string;
  assessmentDate: string;
  description: string | null;
  materials: string | null;
  status: string;
  extraFields: Record<string, unknown>;
};

type AssessmentFormValues = {
  subjectId: string;
  title: string;
  assessmentDate: string;
  description: string;
  materials: string;
  status: AssessmentStatus;
};

type ExtraFieldRow = {
  id: string;
  key: string;
  value: string;
};

type AssessmentFormProps = {
  mode: FormMode;
  assessmentId?: string;
};

type UnknownRecord = Record<string, unknown>;

const ASSESSMENTS_PATH = "/assessments";
const DEFAULT_NOTIFICATION_OFFSETS = [7, 3, 1, 0] as const;
const MIN_NOTIFICATION_OFFSET = 0;
const MAX_NOTIFICATION_OFFSET = 365;

const EMPTY_VALUES: AssessmentFormValues = {
  subjectId: "",
  title: "",
  assessmentDate: "",
  description: "",
  materials: "",
  status: "pending",
};

let nextExtraFieldId = 0;

function createExtraFieldRow(key = "", value = ""): ExtraFieldRow {
  nextExtraFieldId += 1;
  return { id: `extra-field-${nextExtraFieldId}`, key, value };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPayloadError(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(getPayloadError(payload, fallback));
  }

  return payload as T;
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload)) {
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.data)) return payload.data;
  }
  return [];
}

function parseSubjects(payload: unknown): Subject[] {
  return extractList(payload).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "number" ? item.id : Number(item.id);
    return Number.isInteger(id) && id > 0 && typeof item.name === "string"
      ? [{ id, name: item.name }]
      : [];
  });
}

function parseExtraFields(value: unknown): ExtraFieldRow[] {
  if (!isRecord(value)) return [];

  return Object.entries(value).map(([key, fieldValue]) => {
    if (typeof fieldValue === "string") {
      return createExtraFieldRow(key, fieldValue);
    }

    if (fieldValue === null || fieldValue === undefined) {
      return createExtraFieldRow(key);
    }

    if (typeof fieldValue === "number" || typeof fieldValue === "boolean") {
      return createExtraFieldRow(key, String(fieldValue));
    }

    try {
      return createExtraFieldRow(key, JSON.stringify(fieldValue));
    } catch {
      return createExtraFieldRow(key, String(fieldValue));
    }
  });
}

function parseAssessment(payload: unknown): Assessment | null {
  const candidate = isRecord(payload) && isRecord(payload.assessment)
    ? payload.assessment
    : payload;

  if (!isRecord(candidate)) return null;

  const id = typeof candidate.id === "number" ? candidate.id : Number(candidate.id);
  const subjectId = typeof candidate.subjectId === "number"
    ? candidate.subjectId
    : Number(candidate.subjectId);

  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !Number.isInteger(subjectId) ||
    subjectId <= 0 ||
    typeof candidate.title !== "string" ||
    typeof candidate.assessmentDate !== "string"
  ) {
    return null;
  }

  return {
    id,
    subjectId,
    title: candidate.title,
    assessmentDate: candidate.assessmentDate,
    description: typeof candidate.description === "string" ? candidate.description : null,
    materials: typeof candidate.materials === "string" ? candidate.materials : null,
    status: typeof candidate.status === "string" ? candidate.status : "pending",
    extraFields: isRecord(candidate.extraFields) ? candidate.extraFields : {},
  };
}

async function loadAssessment(assessmentId: string): Promise<Assessment> {
  const itemResponse = await fetch(`/api/assessments/${encodeURIComponent(assessmentId)}`, {
    cache: "no-store",
  });

  if (itemResponse.ok) {
    const itemPayload = await readJson<unknown>(itemResponse, "수행평가를 불러오지 못했습니다.");
    const assessment = parseAssessment(itemPayload);
    if (assessment) return assessment;
    throw new Error("수행평가 응답 형식이 올바르지 않습니다.");
  }

  // The list endpoint keeps the page usable while an item GET handler is being added.
  if (itemResponse.status !== 404 && itemResponse.status !== 405) {
    await readJson<unknown>(itemResponse, "수행평가를 불러오지 못했습니다.");
  }

  const listResponse = await fetch("/api/assessments", { cache: "no-store" });
  const listPayload = await readJson<unknown>(listResponse, "수행평가 목록을 불러오지 못했습니다.");
  const assessment = extractList(listPayload)
    .map(parseAssessment)
    .find((item) => item?.id === Number(assessmentId));

  if (!assessment) {
    throw new Error("수행평가를 찾을 수 없습니다.");
  }

  return assessment;
}

function getAssessmentId(payload: unknown): number | null {
  const candidate = isRecord(payload) && isRecord(payload.assessment)
    ? payload.assessment
    : payload;
  if (!isRecord(candidate)) return null;
  const id = typeof candidate.id === "number" ? candidate.id : Number(candidate.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeNotificationOffsets(offsets: number[]): number[] {
  return [...new Set(offsets)]
    .filter((offset) => (
      Number.isInteger(offset) &&
      offset >= MIN_NOTIFICATION_OFFSET &&
      offset <= MAX_NOTIFICATION_OFFSET
    ))
    .sort((left, right) => right - left);
}

function parseNotificationOffsets(payload: unknown): number[] {
  return normalizeNotificationOffsets(
    extractList(payload).flatMap((item) => {
      if (!isRecord(item)) return [];
      if (item.enabled === false) return [];

      const rawOffset = item.offsetDays ?? item.offset_days;
      const offset = typeof rawOffset === "number" ? rawOffset : Number(rawOffset);
      return Number.isInteger(offset) ? [offset] : [];
    }),
  );
}

function formatNotificationOffset(offset: number): string {
  return offset === 0 ? "당일" : `D-${offset}`;
}

function isDefaultNotificationOffset(offset: number): boolean {
  return DEFAULT_NOTIFICATION_OFFSETS.some((defaultOffset) => defaultOffset === offset);
}

async function loadNotificationSettings(assessmentId: number): Promise<number[]> {
  const response = await fetch(`/api/assessments/${encodeURIComponent(String(assessmentId))}/notifications`, {
    cache: "no-store",
  });
  const payload = await readJson<unknown>(response, "알림 설정을 불러오지 못했습니다.");
  return parseNotificationOffsets(payload);
}

async function saveNotificationSettings(assessmentId: number, offsets: number[]): Promise<void> {
  const response = await fetch(`/api/assessments/${encodeURIComponent(String(assessmentId))}/notifications`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offsetDays: normalizeNotificationOffsets(offsets) }),
  });
  await readJson<unknown>(response, "알림 설정을 저장하지 못했습니다.");
}

function getErrorMessage(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

function makeInitialValues(assessment: Assessment): AssessmentFormValues {
  return {
    subjectId: String(assessment.subjectId),
    title: assessment.title,
    assessmentDate: assessment.assessmentDate.slice(0, 10),
    description: assessment.description ?? "",
    materials: assessment.materials ?? "",
    status: assessment.status === "completed" ? "completed" : "pending",
  };
}

function buildExtraFields(rows: ExtraFieldRow[]): {
  fields: Record<string, string>;
  error?: string;
} {
  const fields: Record<string, string> = {};

  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();

    if (!key && !value) continue;
    if (!key) return { fields, error: "부가 정보의 이름을 입력해주세요." };
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      return { fields, error: "부가 정보의 이름은 중복할 수 없습니다." };
    }

    fields[key] = value;
  }

  return { fields };
}

export default function AssessmentForm({ mode, assessmentId }: AssessmentFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [values, setValues] = useState<AssessmentFormValues>(EMPTY_VALUES);
  const [extraFields, setExtraFields] = useState<ExtraFieldRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStage, setSaveStage] = useState<SaveStage>(null);
  const [error, setError] = useState<string | null>(null);
  const [notificationOffsets, setNotificationOffsets] = useState<number[]>(
    () => [...DEFAULT_NOTIFICATION_OFFSETS],
  );
  const [notificationInput, setNotificationInput] = useState("");
  const [notificationInputError, setNotificationInputError] = useState<string | null>(null);
  const [notificationLoadError, setNotificationLoadError] = useState<string | null>(null);
  const [notificationReady, setNotificationReady] = useState(!isEdit);
  const [savedAssessmentId, setSavedAssessmentId] = useState<number | null>(null);
  const [notificationSaveError, setNotificationSaveError] = useState<string | null>(null);

  const loadFormData = useCallback(async () => {
    setIsLoading(true);
    setNotificationLoadError(null);
    setNotificationSaveError(null);
    setSavedAssessmentId(null);
    setNotificationReady(!isEdit);
    setNotificationOffsets(isEdit ? [] : [...DEFAULT_NOTIFICATION_OFFSETS]);

    try {
      setError(null);
      const subjectResponse = await fetch("/api/subjects", { cache: "no-store" });
      const subjectPayload = await readJson<unknown>(subjectResponse, "과목 목록을 불러오지 못했습니다.");
      setSubjects(parseSubjects(subjectPayload));

      if (isEdit) {
        if (!assessmentId) throw new Error("수행평가 식별자가 없습니다.");
        const assessment = await loadAssessment(assessmentId);
        setValues(makeInitialValues(assessment));
        setExtraFields(parseExtraFields(assessment.extraFields));

        try {
          const notificationOffsets = await loadNotificationSettings(assessment.id);
          setNotificationOffsets(notificationOffsets);
          setNotificationReady(true);
        } catch (notificationError) {
          setNotificationReady(false);
          setNotificationLoadError(
            getErrorMessage(notificationError, "알림 설정을 불러오지 못했습니다."),
          );
        }
      } else {
        setNotificationReady(true);
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError, "입력 정보를 불러오지 못했습니다."));
    } finally {
      setIsLoading(false);
    }
  }, [assessmentId, isEdit]);

  useEffect(() => {
    // Initial data hydration is intentionally triggered once the client is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFormData();
  }, [loadFormData]);

  function updateValue<Key extends keyof AssessmentFormValues>(
    key: Key,
    value: AssessmentFormValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateExtraField(rowId: string, key: "key" | "value", value: string) {
    setExtraFields((current) => current.map((row) => (
      row.id === rowId ? { ...row, [key]: value } : row
    )));
  }

  function toggleNotificationOffset(offset: number, enabled: boolean) {
    setNotificationOffsets((current) => normalizeNotificationOffsets(
      enabled ? [...current, offset] : current.filter((item) => item !== offset),
    ));
  }

  function handleAddNotificationOffset() {
    const value = notificationInput.trim();
    const offset = Number(value);

    if (!value || !Number.isInteger(offset) || offset < MIN_NOTIFICATION_OFFSET || offset > MAX_NOTIFICATION_OFFSET) {
      setNotificationInputError("알림 시점은 0에서 365 사이의 정수로 입력해주세요.");
      return;
    }

    setNotificationOffsets((current) => normalizeNotificationOffsets([...current, offset]));
    setNotificationInput("");
    setNotificationInputError(null);
  }

  async function handleRetryNotificationSave() {
    if (!savedAssessmentId) return;

    setIsSaving(true);
    setSaveStage("notifications");
    setNotificationSaveError(null);
    try {
      await saveNotificationSettings(savedAssessmentId, notificationOffsets);
      router.push(`${ASSESSMENTS_PATH}/${savedAssessmentId}`);
    } catch (notificationError) {
      setNotificationSaveError(
        `알림 설정 저장에 실패했습니다. 수행평가는 저장된 상태입니다. ${getErrorMessage(
          notificationError,
          "다시 시도해주세요.",
        )}`,
      );
    } finally {
      setIsSaving(false);
      setSaveStage(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotificationInputError(null);

    if (isEdit && !notificationReady) {
      setError("기존 알림 설정을 불러온 뒤 저장해주세요.");
      return;
    }

    const subjectId = Number(values.subjectId);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      setError("과목을 선택해주세요.");
      return;
    }

    const extraFieldResult = buildExtraFields(extraFields);
    if (extraFieldResult.error) {
      setError(extraFieldResult.error);
      return;
    }

    if (isEdit && !assessmentId) {
      setError("수행평가 식별자가 없습니다.");
      return;
    }

    const url = isEdit && assessmentId
      ? `/api/assessments/${encodeURIComponent(assessmentId)}`
      : "/api/assessments";
    const method = isEdit ? "PUT" : "POST";

    setIsSaving(true);
    setSaveStage("assessment");
    setSavedAssessmentId(null);
    setNotificationSaveError(null);
    void (async () => {
      try {
        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId,
            title: values.title,
            assessmentDate: values.assessmentDate,
            description: values.description,
            materials: values.materials,
            status: values.status,
            extraFields: extraFieldResult.fields,
          }),
        });

        const payload = await readJson<unknown>(
          response,
          isEdit ? "수행평가를 수정하지 못했습니다." : "수행평가를 저장하지 못했습니다.",
        );
        const savedId = isEdit ? Number(assessmentId) : getAssessmentId(payload);

        if (!savedId || !Number.isInteger(savedId) || savedId <= 0) {
          throw new Error("저장된 수행평가 식별자를 확인하지 못했습니다.");
        }

        setSavedAssessmentId(savedId);
        setSaveStage("notifications");
        try {
          await saveNotificationSettings(savedId, notificationOffsets);
        } catch (notificationError) {
          setNotificationSaveError(
            `알림 설정 저장에 실패했습니다. 수행평가는 저장된 상태입니다. ${getErrorMessage(
              notificationError,
              "다시 시도해주세요.",
            )}`,
          );
          return;
        }

        router.push(`${ASSESSMENTS_PATH}/${savedId}`);
      } catch (submitError) {
        setError(getErrorMessage(submitError, "수행평가를 저장하지 못했습니다."));
      } finally {
        setIsSaving(false);
        setSaveStage(null);
      }
    })();
  }

  const pageTitle = isEdit ? "수행평가 수정" : "수행평가 등록";
  const pageDescription = isEdit
    ? "수행평가 정보를 확인하고 필요한 내용을 수정하세요."
    : "핵심 정보와 과목별 추가 정보를 입력해 수행평가를 등록하세요.";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <Link className={styles.backLink} href={ASSESSMENTS_PATH}>
            <span aria-hidden="true">←</span> 수행평가 목록
          </Link>
          <p className={styles.eyebrow}>PACHECKER / ASSESSMENTS</p>
          <h1>{pageTitle}</h1>
          <p className={styles.description}>{pageDescription}</p>
        </div>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}

      {notificationSaveError && savedAssessmentId && (
        <div className={styles.notificationError} role="alert">
          <strong>수행평가는 저장되었습니다.</strong>
          <p>{notificationSaveError}</p>
          <div className={styles.notificationActions}>
            <button
              className={styles.addButton}
              type="button"
              onClick={() => void handleRetryNotificationSave()}
              disabled={isSaving}
            >
              {isSaving && saveStage === "notifications" ? "알림 저장 중..." : "알림 저장 다시 시도"}
            </button>
            <Link className={styles.secondaryButton} href={`${ASSESSMENTS_PATH}/${savedAssessmentId}`}>
              저장된 평가 보기
            </Link>
          </div>
        </div>
      )}

      {isLoading ? (
        <section className={`${styles.card} ${styles.loadingCard}`} aria-live="polite">
          <strong>{isEdit ? "수행평가 정보를 불러오는 중입니다." : "과목 목록을 불러오는 중입니다."}</strong>
          잠시만 기다려주세요.
        </section>
      ) : (
        <section className={styles.card}>
          <form className={styles.form} onSubmit={handleSubmit} aria-busy={isSaving}>
            <section className={styles.section} aria-labelledby="core-fields-heading">
              <div className={styles.sectionHeading}>
                <h2 id="core-fields-heading">기본 정보</h2>
                <p><span className={styles.required}>*</span> 필수 입력</p>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="subjectId">
                    과목<span className={styles.required} aria-hidden="true">*</span>
                  </label>
                  <select
                    className={styles.control}
                    id="subjectId"
                    name="subjectId"
                    value={values.subjectId}
                    onChange={(event) => updateValue("subjectId", event.target.value)}
                    required
                    disabled={subjects.length === 0 || isSaving}
                  >
                    <option value="" disabled>과목 선택</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>{subject.name}</option>
                    ))}
                  </select>
                  {subjects.length === 0 && (
                    <span className={styles.fieldHint}>먼저 과목을 추가한 뒤 수행평가를 등록할 수 있습니다.</span>
                  )}
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="status">상태</label>
                  <select
                    className={styles.control}
                    id="status"
                    name="status"
                    value={values.status}
                    onChange={(event) => updateValue("status", event.target.value as AssessmentStatus)}
                    disabled={isSaving}
                  >
                    <option value="pending">진행 중</option>
                    <option value="completed">완료</option>
                  </select>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="title">
                    제목<span className={styles.required} aria-hidden="true">*</span>
                  </label>
                  <input
                    className={styles.control}
                    id="title"
                    name="title"
                    type="text"
                    value={values.title}
                    onChange={(event) => updateValue("title", event.target.value)}
                    placeholder="예: 국어 발표 평가"
                    maxLength={200}
                    required
                    disabled={isSaving}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="assessmentDate">
                    평가 날짜<span className={styles.required} aria-hidden="true">*</span>
                  </label>
                  <input
                    className={styles.control}
                    id="assessmentDate"
                    name="assessmentDate"
                    type="date"
                    value={values.assessmentDate}
                    onChange={(event) => updateValue("assessmentDate", event.target.value)}
                    required
                    disabled={isSaving}
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label className={styles.label} htmlFor="description">설명</label>
                  <textarea
                    className={styles.control}
                    id="description"
                    name="description"
                    value={values.description}
                    onChange={(event) => updateValue("description", event.target.value)}
                    placeholder="평가 내용이나 안내 사항을 입력하세요."
                    rows={4}
                    disabled={isSaving}
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label className={styles.label} htmlFor="materials">준비물</label>
                  <textarea
                    className={`${styles.control} ${styles.materials}`}
                    id="materials"
                    name="materials"
                    value={values.materials}
                    onChange={(event) => updateValue("materials", event.target.value)}
                    placeholder="준비물이나 제출물을 입력하세요."
                    rows={3}
                    disabled={isSaving}
                  />
                </div>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="extra-fields-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="extra-fields-heading">추가 정보</h2>
                  <p>평가 기준, 배점, 제출 형식 등 필요한 항목을 입력하세요.</p>
                </div>
              </div>

              <div className={styles.extraFields}>
                {extraFields.length === 0 ? (
                  <p className={styles.emptyExtraFields}>추가 정보가 없습니다. 필요하면 항목을 추가하세요.</p>
                ) : (
                  extraFields.map((row, index) => (
                    <div className={styles.extraRow} key={row.id}>
                      <input
                        className={`${styles.control} ${styles.extraInput}`}
                        type="text"
                        value={row.key}
                        onChange={(event) => updateExtraField(row.id, "key", event.target.value)}
                        placeholder="항목 이름"
                        aria-label={`추가 정보 ${index + 1} 항목 이름`}
                        maxLength={100}
                        disabled={isSaving}
                      />
                      <input
                        className={`${styles.control} ${styles.extraInput}`}
                        type="text"
                        value={row.value}
                        onChange={(event) => updateExtraField(row.id, "value", event.target.value)}
                        placeholder="내용"
                        aria-label={`추가 정보 ${index + 1} 내용`}
                        disabled={isSaving}
                      />
                      <button
                        className={styles.removeButton}
                        type="button"
                        onClick={() => setExtraFields((current) => current.filter((item) => item.id !== row.id))}
                        disabled={isSaving}
                      >
                        삭제
                      </button>
                    </div>
                  ))
                )}

                <button
                  className={styles.addButton}
                  type="button"
                  onClick={() => setExtraFields((current) => [...current, createExtraFieldRow()])}
                  disabled={isSaving}
                >
                  + 항목 추가
                </button>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="notification-settings-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="notification-settings-heading">알림 설정</h2>
                  <p>원하는 시점에 수행평가 알림을 받을 수 있습니다.</p>
                </div>
              </div>

              {notificationLoadError && (
                <div className={styles.notificationLoadError} role="alert">
                  <p>{notificationLoadError}</p>
                  <button
                    className={styles.retryButton}
                    type="button"
                    onClick={() => void loadFormData()}
                    disabled={isLoading || isSaving}
                  >
                    다시 불러오기
                  </button>
                </div>
              )}

              <div className={styles.notificationOptions} aria-disabled={!notificationReady}>
                {DEFAULT_NOTIFICATION_OFFSETS.map((offset) => (
                  <label
                    className={`${styles.notificationOption} ${
                      notificationOffsets.includes(offset) ? styles.notificationOptionSelected : ""
                    }`}
                    key={offset}
                  >
                    <input
                      type="checkbox"
                      checked={notificationOffsets.includes(offset)}
                      onChange={(event) => toggleNotificationOffset(offset, event.target.checked)}
                      disabled={!notificationReady || isSaving}
                    />
                    <span className={styles.notificationOptionCopy}>
                      <strong>{formatNotificationOffset(offset)}</strong>
                      <span>{offset === 0 ? "평가 날짜" : `${offset}일 전`}</span>
                    </span>
                  </label>
                ))}

                {notificationOffsets.filter((offset) => !isDefaultNotificationOffset(offset)).map((offset) => (
                  <label
                    className={`${styles.notificationOption} ${styles.notificationOptionSelected}`}
                    key={offset}
                  >
                    <input
                      type="checkbox"
                      checked
                      onChange={(event) => toggleNotificationOffset(offset, event.target.checked)}
                      disabled={!notificationReady || isSaving}
                    />
                    <span className={styles.notificationOptionCopy}>
                      <strong>{formatNotificationOffset(offset)}</strong>
                      <span>사용자 지정</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className={styles.customNotification}>
                <label className={styles.label} htmlFor="customNotificationOffset">
                  사용자 지정 offset
                </label>
                <div className={styles.customNotificationRow}>
                  <input
                    className={`${styles.control} ${styles.customOffsetInput}`}
                    id="customNotificationOffset"
                    type="number"
                    min={MIN_NOTIFICATION_OFFSET}
                    max={MAX_NOTIFICATION_OFFSET}
                    step="1"
                    inputMode="numeric"
                    placeholder="예: 5"
                    value={notificationInput}
                    onChange={(event) => {
                      setNotificationInput(event.target.value);
                      setNotificationInputError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddNotificationOffset();
                      }
                    }}
                    disabled={!notificationReady || isSaving}
                    aria-describedby={notificationInputError ? "custom-notification-error" : undefined}
                  />
                  <button
                    className={styles.addButton}
                    type="button"
                    onClick={handleAddNotificationOffset}
                    disabled={!notificationReady || isSaving}
                  >
                    알림 추가
                  </button>
                </div>
                <p className={styles.fieldHint}>0은 당일이며, 365까지 입력할 수 있습니다.</p>
                {notificationInputError && (
                  <p className={styles.inlineError} id="custom-notification-error" role="alert">
                    {notificationInputError}
                  </p>
                )}
              </div>
            </section>

            <div className={styles.formActions}>
              <Link className={styles.secondaryButton} href={ASSESSMENTS_PATH}>
                취소
              </Link>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={
                  isSaving ||
                  subjects.length === 0 ||
                  !notificationReady ||
                  (!isEdit && Boolean(notificationSaveError))
                }
              >
                {isSaving
                  ? saveStage === "notifications" ? "알림 저장 중..." : "수행평가 저장 중..."
                  : isEdit ? "수정 내용 저장" : "수행평가 저장"}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
