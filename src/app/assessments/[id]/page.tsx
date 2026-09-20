"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatDday, getDday } from "@/lib/date/d-day";
import styles from "./page.module.css";

type Assessment = {
  id: number;
  subjectId: number;
  subjectName: string;
  title: string;
  assessmentDate: string;
  description: string | null;
  materials: string | null;
  status: string;
  extraFields: Record<string, unknown>;
  sourceImage?: unknown;
  sourceImages?: unknown;
  source_image?: unknown;
  source_images?: unknown;
  sourceImageUrl?: unknown;
  source_image_url?: unknown;
};

type NotificationSetting = {
  id: number;
  assessmentId: number;
  offsetDays: number;
  enabled: boolean;
};

type AssessmentResponse = Assessment | { assessment: Assessment };
type Action = "status" | "delete" | null;

type SourceImageReference = {
  key: string;
  url: string | null;
  name: string | null;
  mimeType: string | null;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "요청 처리에 실패했습니다.");
  }
  return data;
}

function getAssessment(data: AssessmentResponse): Assessment {
  if ("assessment" in data) {
    return data.assessment;
  }
  return data;
}

function formatExtraField(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value, null, 2) ?? "-";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getSourceImages(assessment: Assessment): SourceImageReference[] {
  const values: unknown[] = [];
  const sourceValues = [
    assessment.sourceImages,
    assessment.source_images,
    assessment.sourceImage,
    assessment.source_image,
  ];

  for (const value of sourceValues) {
    if (Array.isArray(value)) {
      values.push(...value);
    } else if (value !== undefined && value !== null) {
      values.push(value);
    }
  }

  const directUrl = firstString(
    assessment as unknown as Record<string, unknown>,
    ["sourceImageUrl", "source_image_url"],
  );
  if (directUrl && values.length === 0) {
    values.push(directUrl);
  }

  return values.reduce<SourceImageReference[]>((images, value, index) => {
    if (typeof value === "string" && value.trim()) {
      images.push({
        key: `source-image-${index}`,
        url: value.trim(),
        name: null,
        mimeType: null,
      });
      return images;
    }

    if (!isRecord(value)) {
      return images;
    }

    const url = firstString(value, [
      "url",
      "href",
      "src",
      "imageUrl",
      "image_url",
      "previewUrl",
      "preview_url",
    ]);
    const name = firstString(value, [
      "originalFilename",
      "original_filename",
      "filename",
      "name",
    ]);
    const mimeType = firstString(value, ["mimeType", "mime_type", "type"]);
    const storageKey = firstString(value, ["storageKey", "storage_key"]);
    const id = typeof value.id === "string" || typeof value.id === "number" ? String(value.id) : null;

    images.push({
      key: `source-image-${id ?? storageKey ?? index}`,
      url,
      name: name ?? storageKey,
      mimeType,
    });
    return images;
  }, []);
}

function formatNotificationOffset(offsetDays: number): string {
  return offsetDays === 0 ? "D-Day" : `D-${offsetDays}`;
}

function describeNotificationOffset(offsetDays: number): string {
  return offsetDays === 0 ? "평가 당일" : `평가 ${offsetDays}일 전`;
}

export default function AssessmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [notifications, setNotifications] = useState<NotificationSetting[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  const loadAssessment = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/assessments/${id}`, { cache: "no-store" });
      const data = await readJson<AssessmentResponse>(response);
      setAssessment(getAssessment(data));
    } catch (loadError) {
      setAssessment(null);
      setError(loadError instanceof Error ? loadError.message : "수행평가를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // Initial data hydration is intentionally triggered once the client is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAssessment();
  }, [loadAssessment]);

  const loadNotifications = useCallback(async () => {
    try {
      setNotificationsLoading(true);
      setNotificationsError(null);
      const response = await fetch(`/api/assessments/${id}/notifications`, { cache: "no-store" });
      const data = await readJson<NotificationSetting[]>(response);
      setNotifications(data);
    } catch (notificationLoadError) {
      setNotifications([]);
      setNotificationsError(
        notificationLoadError instanceof Error
          ? notificationLoadError.message
          : "알림 설정을 불러오지 못했습니다.",
      );
    } finally {
      setNotificationsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // Notification loading has its own error state so the assessment detail remains usable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadNotifications();
  }, [loadNotifications]);

  async function handleStatusToggle() {
    if (!assessment) return;

    const nextStatus = assessment.status === "completed" ? "pending" : "completed";
    try {
      setAction("status");
      setError(null);
      const response = await fetch(`/api/assessments/${assessment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: assessment.subjectId,
          title: assessment.title,
          assessmentDate: assessment.assessmentDate,
          description: assessment.description,
          materials: assessment.materials,
          status: nextStatus,
          extraFields: assessment.extraFields,
        }),
      });
      await readJson<{ ok: true }>(response);
      setAssessment((current) => current ? { ...current, status: nextStatus } : current);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "상태를 변경하지 못했습니다.");
    } finally {
      setAction(null);
    }
  }

  async function handleDelete() {
    if (!assessment || !window.confirm(`'${assessment.title}' 수행평가를 삭제하시겠습니까?`)) {
      return;
    }

    try {
      setAction("delete");
      setError(null);
      const response = await fetch(`/api/assessments/${assessment.id}`, { method: "DELETE" });
      await readJson<{ ok: true }>(response);
      router.push("/assessments");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "수행평가를 삭제하지 못했습니다.");
      setAction(null);
    }
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <Link className={styles.backLink} href="/assessments">← 목록으로</Link>
        <section className={styles.stateCard} aria-live="polite">
          <p>수행평가를 불러오는 중...</p>
        </section>
      </main>
    );
  }

  if (error || !assessment) {
    return (
      <main className={styles.page}>
        <Link className={styles.backLink} href="/assessments">← 목록으로</Link>
        <section className={styles.stateCard} role="alert">
          <p>{error ?? "수행평가를 찾을 수 없습니다."}</p>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadAssessment()}>
            다시 불러오기
          </button>
        </section>
      </main>
    );
  }

  const isCompleted = assessment.status === "completed";
  const extraFields = Object.entries(assessment.extraFields);
  const dday = getDday(assessment.assessmentDate);
  const sourceImages = getSourceImages(assessment);

  return (
    <main className={styles.page}>
      <div className={styles.topBar}>
        <Link className={styles.backLink} href="/assessments">← 목록으로</Link>
        <Link className={styles.editLink} href={`/assessments/${assessment.id}/edit`}>
          수정
        </Link>
      </div>

      <header className={styles.header}>
        <div className={styles.headingCopy}>
          <p className={styles.eyebrow}>수행평가 상세</p>
          <div className={styles.titleRow}>
            <h1>{assessment.title}</h1>
            <span className={`${styles.status} ${isCompleted ? styles.completed : ""}`}>
              {isCompleted ? "완료" : "진행 중"}
            </span>
          </div>
          <p className={styles.subject}>{assessment.subjectName}</p>
        </div>
        <div className={styles.dateHighlight}>
          <span>평가 날짜</span>
          <time dateTime={assessment.assessmentDate}>{assessment.assessmentDate}</time>
          <strong className={styles.dday}>{formatDday(dday)}</strong>
        </div>
      </header>

      <div className={styles.contentGrid}>
        <section className={styles.card} aria-labelledby="core-information">
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.sectionKicker}>CORE FIELDS</p>
              <h2 id="core-information">기본 정보</h2>
            </div>
          </div>
          <dl className={styles.coreList}>
            <div>
              <dt>제목</dt>
              <dd>{assessment.title}</dd>
            </div>
            <div>
              <dt>과목</dt>
              <dd>{assessment.subjectName}</dd>
            </div>
            <div>
              <dt>날짜</dt>
              <dd><time dateTime={assessment.assessmentDate}>{assessment.assessmentDate}</time></dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>{isCompleted ? "완료" : "진행 중"}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.card} aria-labelledby="description">
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.sectionKicker}>DESCRIPTION</p>
              <h2 id="description">평가 내용</h2>
            </div>
          </div>
          <p className={`${styles.longText} ${!assessment.description ? styles.muted : ""}`}>
            {assessment.description || "등록된 평가 내용이 없습니다."}
          </p>
        </section>

        <section className={styles.card} aria-labelledby="materials">
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.sectionKicker}>MATERIALS</p>
              <h2 id="materials">준비물</h2>
            </div>
          </div>
          <p className={`${styles.longText} ${!assessment.materials ? styles.muted : ""}`}>
            {assessment.materials || "등록된 준비물이 없습니다."}
          </p>
        </section>

        <section className={`${styles.card} ${styles.extraCard}`} aria-labelledby="extra-fields">
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.sectionKicker}>EXTRA FIELDS</p>
              <h2 id="extra-fields">추가 정보</h2>
            </div>
            <span className={styles.fieldCount}>{extraFields.length}개</span>
          </div>
          {extraFields.length === 0 ? (
            <p className={styles.muted}>등록된 추가 정보가 없습니다.</p>
          ) : (
            <dl className={styles.extraList}>
              {extraFields.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{formatExtraField(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className={`${styles.card} ${styles.wideCard}`} aria-labelledby="notifications">
          <div className={styles.cardHeader}>
            <div>
              <p className={styles.sectionKicker}>REMINDERS</p>
              <h2 id="notifications">알림 설정</h2>
            </div>
            {!notificationsLoading && !notificationsError && (
              <span className={styles.fieldCount}>{notifications.length}개</span>
            )}
          </div>
          {notificationsLoading ? (
            <p className={styles.muted} aria-live="polite">알림 설정을 불러오는 중...</p>
          ) : notificationsError ? (
            <div className={styles.notificationState} role="alert">
              <p>{notificationsError}</p>
              <button
                className={styles.retryButton}
                type="button"
                onClick={() => void loadNotifications()}
                disabled={notificationsLoading}
              >
                다시 시도
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <p className={styles.muted}>설정된 알림이 없습니다.</p>
          ) : (
            <ul className={styles.notificationList}>
              {notifications.map((notification) => (
                <li className={styles.notificationItem} key={notification.id}>
                  <span className={styles.notificationMark} aria-hidden="true">◷</span>
                  <div className={styles.notificationCopy}>
                    <strong>{formatNotificationOffset(notification.offsetDays)}</strong>
                    <span>{describeNotificationOffset(notification.offsetDays)}</span>
                  </div>
                  <span className={notification.enabled ? styles.enabled : styles.disabled}>
                    {notification.enabled ? "사용 중" : "꺼짐"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {sourceImages.length > 0 && (
          <section className={`${styles.card} ${styles.wideCard} ${styles.sourceCard}`} aria-labelledby="source-images">
            <details className={styles.sourceDetails}>
              <summary className={styles.sourceSummary}>
                <span>
                  <span className={styles.sectionKicker}>REFERENCE</span>
                  <strong id="source-images">원본 이미지 재확인</strong>
                </span>
                <span className={styles.sourceSummaryMeta}>
                  {sourceImages.length}개 <span aria-hidden="true">⌄</span>
                </span>
              </summary>
              <div className={styles.sourceContent}>
                <p className={styles.sourceDescription}>
                  등록할 때 보관한 원본을 열어 수행평가 내용을 다시 확인할 수 있습니다.
                </p>
                <div className={styles.sourceGrid}>
                  {sourceImages.map((image) => (
                    <article className={styles.sourceItem} key={image.key}>
                      {image.url ? (
                        <a
                          className={styles.sourcePreview}
                          href={image.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img src={image.url} alt={`${image.name ?? "원본 이미지"} 미리보기`} />
                        </a>
                      ) : (
                        <div className={styles.sourceUnavailable}>
                          <span aria-hidden="true">▧</span>
                          원본 이미지 링크가 없습니다.
                        </div>
                      )}
                      <div className={styles.sourceMeta}>
                        <strong>{image.name ?? "원본 이미지"}</strong>
                        {image.mimeType && <span>{image.mimeType}</span>}
                        {image.url && (
                          <a href={image.url} target="_blank" rel="noreferrer">
                            새 탭에서 원본 열기 ↗
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </details>
          </section>
        )}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <section className={styles.actionCard} aria-label="수행평가 관리">
        <div>
          <p className={styles.actionTitle}>{isCompleted ? "완료된 수행평가" : "진행 중인 수행평가"}</p>
          <p className={styles.actionDescription}>
            상태를 바꾸거나 이 수행평가를 목록에서 삭제할 수 있습니다.
          </p>
        </div>
        <div className={styles.actionButtons}>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => void handleStatusToggle()}
            disabled={action !== null}
          >
            {action === "status" ? "저장 중..." : isCompleted ? "진행 중으로 표시" : "완료로 표시"}
          </button>
          <button
            className={styles.deleteButton}
            type="button"
            onClick={() => void handleDelete()}
            disabled={action !== null}
          >
            {action === "delete" ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </section>
    </main>
  );
}
