"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateLabel, formatDday, getDday, getLocalDateKey } from "@/lib/date/d-day";
import styles from "./page.module.css";

type DueNotification = {
  id: number;
  assessmentId: number;
  offsetDays: number;
  title: string;
  subjectName: string;
  assessmentDate: string;
};

type Assessment = {
  id: number;
  subjectName: string;
  title: string;
  assessmentDate: string;
  status: "pending" | "completed";
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "요청 처리에 실패했습니다.");
  }
  return data;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getDdayClass(days: number | null) {
  if (days === null) return styles.ddayUnknown;
  if (days === 0) return styles.ddayToday;
  if (days < 0) return styles.ddayPast;
  return styles.ddayUpcoming;
}

function getSchedulePriority(days: number | null) {
  if (days === null) return 3;
  if (days < 0) return 0;
  if (days === 0) return 1;
  return 2;
}

function comparePendingAssessments(left: Assessment, right: Assessment) {
  const leftDays = getDday(left.assessmentDate);
  const rightDays = getDday(right.assessmentDate);
  const priorityDifference = getSchedulePriority(leftDays) - getSchedulePriority(rightDays);

  if (priorityDifference !== 0) return priorityDifference;
  if (leftDays === null || rightDays === null) {
    return left.title.localeCompare(right.title, "ko");
  }

  // 최근에 기한이 지난 항목부터 보여주고, 오늘 이후는 가까운 날짜부터 보여준다.
  if (leftDays < 0 && rightDays < 0) return rightDays - leftDays;
  return leftDays - rightDays;
}

function getAssessmentEmphasisClass(days: number | null) {
  if (days === null) return "";
  if (days < 0) return styles.assessmentOverdue;
  if (days === 0) return styles.assessmentToday;
  if (days <= 7) return styles.assessmentImminent;
  return "";
}

export default function Dashboard() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [dueNotifications, setDueNotifications] = useState<DueNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setNotificationLoading(true);
    setAssessmentError(null);
    setNotificationError(null);

    const localDate = getLocalDateKey();
    const assessmentTask = fetch("/api/assessments", { cache: "no-store" })
      .then((response) => readJson<Assessment[]>(response))
      .then((items) => setAssessments(items))
      .catch((error: unknown) => {
        setAssessmentError(getErrorMessage(error, "수행평가 목록을 불러오지 못했습니다."));
      })
      .finally(() => setLoading(false));

    const notificationTask = fetch(`/api/notifications/due?date=${localDate}`, { cache: "no-store" })
      .then((response) => readJson<DueNotification[]>(response))
      .then((items) => setDueNotifications(items))
      .catch((error: unknown) => {
        setDueNotifications([]);
        setNotificationError(getErrorMessage(error, "오늘 알림을 불러오지 못했습니다."));
      })
      .finally(() => setNotificationLoading(false));

    await Promise.all([assessmentTask, notificationTask]);
  }, []);

  useEffect(() => {
    // Initial data hydration is intentionally triggered once the client is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const pendingAssessments = useMemo(
    () =>
      assessments
        .filter((assessment) => assessment.status !== "completed")
        .sort(comparePendingAssessments),
    [assessments],
  );
  const pendingCount = pendingAssessments.length;
  const completedCount = assessments.filter((assessment) => assessment.status === "completed").length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PAChecker · TODAY</p>
          <h1>수행평가 대시보드</h1>
          <p className={styles.description}>오늘 확인할 일정과 진행 중인 수행평가를 한곳에서 관리합니다.</p>
        </div>
        <nav className={styles.headerActions} aria-label="주요 메뉴">
          <Link className={styles.secondaryButton} href="/subjects">과목 관리</Link>
          <Link className={styles.secondaryButton} href="/assessments">전체 목록</Link>
          <Link className={styles.secondaryButton} href="/assessments/import">이미지로 등록</Link>
          <Link className={styles.primaryButton} href="/assessments/new">수행평가 등록</Link>
        </nav>
      </header>

      {assessmentError && (
        <div className={styles.error} role="alert">
          <span>수행평가 목록을 불러오지 못했습니다. {assessmentError}</span>
          <button type="button" onClick={() => void loadData()}>다시 시도</button>
        </div>
      )}

      <section className={styles.summaryGrid} aria-label="수행평가 요약">
        <article className={styles.summaryCard}>
          <span>전체</span>
          <strong>{assessments.length}</strong>
          <small>등록된 수행평가</small>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryCardPending}`}>
          <span>진행 중</span>
          <strong>{pendingCount}</strong>
          <small>완료 전 항목</small>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryCardCompleted}`}>
          <span>완료</span>
          <strong>{completedCount}</strong>
          <small>마친 수행평가</small>
        </article>
      </section>

      <section
        className={`${styles.listSection} ${styles.notificationSection}`}
        aria-labelledby="today-notification-heading"
        aria-busy={notificationLoading}
      >
        <div className={styles.cardHeader}>
          <div>
            <p className={styles.sectionEyebrow}>TODAY · 알림</p>
            <h2 id="today-notification-heading">오늘 알림</h2>
            <p>설정한 알림 시점에 도달한 수행평가를 확인합니다.</p>
          </div>
          <span className={`${styles.notificationCount} ${notificationError ? styles.notificationCountError : ""}`}>
            {notificationLoading ? "확인 중" : `${dueNotifications.length}건`}
          </span>
        </div>

        {notificationLoading ? (
          <div className={styles.notificationState} role="status">
            <span className={styles.notificationStateIcon} aria-hidden="true">…</span>
            <p>오늘 알림을 확인하는 중입니다.</p>
          </div>
        ) : notificationError ? (
          <div className={`${styles.notificationState} ${styles.notificationStateError}`} role="alert">
            <p>오늘 알림을 확인하지 못했습니다.</p>
            <span>{notificationError}</span>
            <button type="button" onClick={() => void loadData()}>다시 시도</button>
          </div>
        ) : dueNotifications.length === 0 ? (
          <div className={styles.notificationState}>
            <span className={styles.notificationStateIcon} aria-hidden="true">✓</span>
            <p>오늘 도착한 알림이 없습니다.</p>
            <span>설정된 알림은 해당 날짜에 표시됩니다.</span>
          </div>
        ) : (
          <div className={styles.assessmentList}>
            {dueNotifications.map((item) => {
              const dday = getDday(item.assessmentDate);

              return (
                <Link
                  className={`${styles.assessment} ${styles.notificationItem}`}
                  href={`/assessments/${item.assessmentId}`}
                  key={item.id}
                >
                  <div>
                    <div className={styles.assessmentMeta}>
                      <span>{item.subjectName}</span>
                      <time dateTime={item.assessmentDate}>{formatDateLabel(item.assessmentDate)}</time>
                    </div>
                    <h3>{item.title}</h3>
                  </div>
                  <div className={styles.assessmentSide}>
                    <span className={`${styles.ddayBadge} ${getDdayClass(dday)}`}>{formatDday(dday)}</span>
                    <span className={styles.openLabel}>확인 →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.listSection} aria-labelledby="pending-assessments-heading" aria-busy={loading}>
        <div className={styles.cardHeader}>
          <div>
            <p className={styles.sectionEyebrow}>UP NEXT · 일정</p>
            <h2 id="pending-assessments-heading">진행 중 수행평가</h2>
            <p>기한 경과 항목부터 오늘, 임박한 일정 순으로 모두 표시합니다.</p>
          </div>
          <div className={styles.cardHeaderActions}>
            <Link className={styles.viewAllLink} href="/assessments?status=pending">진행 중 전체 보기 →</Link>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
            >
              {loading ? "불러오는 중" : "새로고침"}
            </button>
          </div>
        </div>

        {loading ? (
          <p className={styles.empty} role="status">수행평가를 불러오는 중입니다.</p>
        ) : assessmentError && assessments.length === 0 ? (
          <div className={styles.emptyState}>
            <p>목록을 표시할 수 없습니다.</p>
            <button type="button" onClick={() => void loadData()}>다시 시도</button>
          </div>
        ) : pendingAssessments.length === 0 ? (
          <div className={styles.emptyState}>
            <p>진행 중인 수행평가가 없습니다.</p>
            <Link href="/assessments/new">새 수행평가 등록</Link>
          </div>
        ) : (
          <div className={styles.assessmentList}>
            {pendingAssessments.map((assessment) => {
              const dday = getDday(assessment.assessmentDate);
              const ddayLabel = formatDday(dday);

              return (
                <Link
                  className={`${styles.assessment} ${getAssessmentEmphasisClass(dday)}`}
                  href={`/assessments/${assessment.id}`}
                  key={assessment.id}
                  aria-label={`${assessment.title}, ${ddayLabel}, 상세 보기`}
                >
                  <div>
                    <div className={styles.assessmentMeta}>
                      <span>{assessment.subjectName}</span>
                      <time dateTime={assessment.assessmentDate}>{formatDateLabel(assessment.assessmentDate)}</time>
                    </div>
                    <h3>{assessment.title}</h3>
                  </div>
                  <div className={styles.assessmentSide}>
                    <span className={`${styles.ddayBadge} ${getDdayClass(dday)}`}>{ddayLabel}</span>
                    <span className={styles.openLabel}>상세 보기 →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
