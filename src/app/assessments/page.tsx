"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { formatDateLabel, formatDday, getDday } from "@/lib/date/d-day";
import styles from "./assessments.module.css";

type Subject = {
  id: number;
  name: string;
};

type Assessment = {
  id: number;
  subjectId: number;
  subjectName: string;
  title: string;
  assessmentDate: string;
  description: string | null;
  materials: string | null;
  status: string;
};

type StatusFilter = "all" | "pending" | "completed";
type SortOrder = "date-asc" | "date-desc" | "title";

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "요청 처리에 실패했습니다.");
  }
  return data;
}

function getDateKey(value: string) {
  return value.slice(0, 10);
}

function getStatusLabel(status: string) {
  return status === "completed" ? "완료" : "진행 중";
}

function getDdayClass(days: number | null) {
  if (days === null) return styles.ddayUnknown;
  if (days === 0) return styles.ddayToday;
  if (days < 0) return styles.ddayPast;
  return styles.ddayUpcoming;
}

export default function AssessmentsPage() {
  return (
    <Suspense fallback={<AssessmentsPageFallback />}>
      <AssessmentsContent />
    </Suspense>
  );
}

function AssessmentsPageFallback() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.stateCard} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <h3>수행평가 목록을 준비하는 중입니다.</h3>
        </div>
      </div>
    </main>
  );
}

function AssessmentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("date-asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subjectFilter = searchParams.get("subject") ?? "";
  const statusParam = searchParams.get("status");
  const statusFilter: StatusFilter =
    statusParam === "pending" || statusParam === "completed" ? statusParam : "all";

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      setError(null);
      const [subjectResponse, assessmentResponse] = await Promise.all([
        fetch("/api/subjects", { cache: "no-store" }),
        fetch("/api/assessments", { cache: "no-store" }),
      ]);
      const [subjectData, assessmentData] = await Promise.all([
        readJson<Subject[]>(subjectResponse),
        readJson<Assessment[]>(assessmentResponse),
      ]);

      setSubjects(subjectData);
      setAssessments(assessmentData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data hydration is intentionally triggered once the client is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const filteredAssessments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

    return assessments
      .filter((assessment) => {
        if (subjectFilter && String(assessment.subjectId) !== subjectFilter) {
          return false;
        }

        if (statusFilter !== "all" && assessment.status !== statusFilter) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        const searchableText = [
          assessment.title,
          assessment.subjectName,
          assessment.description ?? "",
          assessment.materials ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase("ko-KR");

        return searchableText.includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (sortOrder === "title") {
          return left.title.localeCompare(right.title, "ko");
        }

        const dateComparison = getDateKey(left.assessmentDate).localeCompare(
          getDateKey(right.assessmentDate),
        );
        return sortOrder === "date-desc" ? -dateComparison : dateComparison;
      });
  }, [assessments, query, sortOrder, statusFilter, subjectFilter]);

  const pendingCount = assessments.filter((assessment) => assessment.status !== "completed").length;
  const completedCount = assessments.filter((assessment) => assessment.status === "completed").length;
  const hasActiveFilters = Boolean(query || subjectFilter || statusFilter !== "all" || sortOrder !== "date-asc");

  function updateUrlFilter(key: "subject" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    const isDefault = (key === "subject" && value === "") || (key === "status" && value === "all");

    if (isDefault) {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `/assessments?${nextQuery}` : "/assessments", { scroll: false });
  }

  function getSubjectHref(subjectId: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("subject", String(subjectId));
    return `/assessments?${params.toString()}`;
  }

  function resetFilters() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("subject");
    params.delete("status");
    setQuery("");
    setSortOrder("date-asc");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `/assessments?${nextQuery}` : "/assessments", { scroll: false });
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headingGroup}>
            <p className={styles.eyebrow}>PAChecker · 관리</p>
            <h1>수행평가 목록</h1>
            <p className={styles.description}>
              과목별 수행평가를 한눈에 확인하고, 필요한 내용을 빠르게 찾아보세요.
            </p>
          </div>

          <div className={styles.headerActions}>
            <Link className={styles.secondaryLink} href="/">
              대시보드
            </Link>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
            >
              {loading ? "불러오는 중" : "새로고침"}
            </button>
            <Link className={styles.primaryLink} href="/assessments/new">
              <span aria-hidden="true">+</span>
              새 수행평가
            </Link>
          </div>
        </header>

        {error && (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadData()}>
              다시 시도
            </button>
          </div>
        )}

        <section className={styles.summaryGrid} aria-label="수행평가 현황">
          <article className={styles.summaryCard}>
            <span className={styles.summaryLabel}>전체</span>
            <strong className={styles.summaryValue}>{assessments.length}</strong>
            <span className={styles.summaryHint}>등록된 수행평가</span>
          </article>
          <article className={`${styles.summaryCard} ${styles.summaryCardPending}`}>
            <span className={styles.summaryLabel}>진행 중</span>
            <strong className={styles.summaryValue}>{pendingCount}</strong>
            <span className={styles.summaryHint}>완료 전 항목</span>
          </article>
          <article className={`${styles.summaryCard} ${styles.summaryCardCompleted}`}>
            <span className={styles.summaryLabel}>완료</span>
            <strong className={styles.summaryValue}>{completedCount}</strong>
            <span className={styles.summaryHint}>마친 수행평가</span>
          </article>
        </section>

        <section className={styles.toolbar} aria-label="수행평가 필터와 정렬">
          <div className={styles.toolbarHeading}>
            <div>
              <p className={styles.sectionEyebrow}>필터 및 정렬</p>
              <h2>목록 정리하기</h2>
            </div>
            {hasActiveFilters && (
              <button className={styles.resetButton} type="button" onClick={resetFilters}>
                초기화
              </button>
            )}
          </div>

          <div className={styles.controls}>
            <label className={`${styles.field} ${styles.searchField}`}>
              <span className={styles.fieldLabel}>검색</span>
              <span className={styles.inputWithIcon}>
                <span className={styles.searchIcon} aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="제목, 과목, 내용 검색"
                  aria-label="수행평가 검색"
                />
              </span>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>과목</span>
              <select
                value={subjectFilter}
                onChange={(event) => updateUrlFilter("subject", event.target.value)}
                aria-label="과목별 수행평가 필터"
              >
                <option value="">모든 과목</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>상태</span>
              <select
                value={statusFilter}
                onChange={(event) => updateUrlFilter("status", event.target.value)}
                aria-label="수행평가 상태 필터"
              >
                <option value="all">모든 상태</option>
                <option value="pending">진행 중</option>
                <option value="completed">완료</option>
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>날짜 정렬</span>
              <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)}>
                <option value="date-asc">날짜 빠른 순</option>
                <option value="date-desc">날짜 늦은 순</option>
                <option value="title">제목 가나다순</option>
              </select>
            </label>
          </div>
        </section>

        <section className={styles.listSection} aria-labelledby="assessment-list-heading" aria-busy={loading}>
          <div className={styles.listHeader}>
            <div>
              <p className={styles.sectionEyebrow}>나의 일정</p>
              <h2 id="assessment-list-heading">수행평가</h2>
            </div>
            <span className={styles.resultCount}>
              {loading ? "확인 중" : `${filteredAssessments.length}개 표시`}
            </span>
          </div>

          {loading ? (
            <div className={styles.stateCard} role="status">
              <span className={styles.spinner} aria-hidden="true" />
              <h3>수행평가를 불러오는 중입니다.</h3>
              <p>잠시만 기다려 주세요.</p>
            </div>
          ) : filteredAssessments.length === 0 ? (
            <div className={styles.stateCard}>
              <div className={styles.emptyIcon} aria-hidden="true">✓</div>
              <h3>{assessments.length === 0 ? "아직 등록된 수행평가가 없습니다." : "조건에 맞는 수행평가가 없습니다."}</h3>
              <p>
                {assessments.length === 0
                  ? "새 수행평가를 등록하면 이곳에서 일정을 관리할 수 있습니다."
                  : "다른 검색어나 필터를 선택해 보세요."}
              </p>
              {assessments.length === 0 ? (
                <Link className={styles.stateAction} href="/assessments/new">
                  첫 수행평가 등록
                </Link>
              ) : (
                <button className={styles.stateAction} type="button" onClick={resetFilters}>
                  필터 초기화
                </button>
              )}
            </div>
          ) : (
            <div className={styles.assessmentList}>
              {filteredAssessments.map((assessment) => {
                const dday = getDday(assessment.assessmentDate);

                return (
                  <article className={styles.assessmentCard} key={assessment.id}>
                    <div className={styles.cardTopline}>
                      <Link
                        className={styles.subjectTag}
                        href={getSubjectHref(assessment.subjectId)}
                        aria-label={`${assessment.subjectName} 과목 수행평가만 보기`}
                      >
                        <span className={styles.subjectDot} aria-hidden="true" />
                        {assessment.subjectName}
                      </Link>
                      <span
                        className={`${styles.statusBadge} ${
                          assessment.status === "completed" ? styles.statusCompleted : styles.statusPending
                        }`}
                      >
                        {getStatusLabel(assessment.status)}
                      </span>
                    </div>

                    <Link className={styles.assessmentLink} href={`/assessments/${assessment.id}`}>
                      <h3>{assessment.title}</h3>
                      <div className={styles.assessmentDateRow}>
                        <time className={styles.assessmentDate} dateTime={getDateKey(assessment.assessmentDate)}>
                          <span aria-hidden="true">◷</span>
                          {formatDateLabel(assessment.assessmentDate)}
                        </time>
                        <span className={`${styles.ddayBadge} ${getDdayClass(dday)}`}>
                          {formatDday(dday)}
                        </span>
                      </div>
                    </Link>

                    {assessment.description && <p className={styles.assessmentDescription}>{assessment.description}</p>}
                    {assessment.materials && (
                      <p className={styles.materials}>
                        <strong>준비물</strong>
                        <span>{assessment.materials}</span>
                      </p>
                    )}

                    <div className={styles.cardFooter}>
                      <span className={styles.cardFooterHint}>상세 정보와 수정</span>
                      <Link className={styles.detailLink} href={`/assessments/${assessment.id}`}>
                        상세 보기 <span aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
