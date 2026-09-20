"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./subjects.module.css";

type Subject = { id: number; name: string };

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "요청 처리에 실패했습니다.");
  return data;
}

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSubjects = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/subjects", { cache: "no-store" });
      setSubjects(await readJson<Subject[]>(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "과목을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSubjects();
  }, [loadSubjects]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      setError(null);
      const response = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formData.get("name") }),
      });
      await readJson<Subject>(response);
      form.reset();
      await loadSubjects();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "과목을 추가하지 못했습니다.");
    }
  }

  async function handleRename(subject: Subject) {
    const name = window.prompt("새 과목명을 입력하십시오.", subject.name);
    if (name === null || name.trim() === subject.name) return;
    try {
      setError(null);
      const response = await fetch(`/api/subjects/${subject.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await readJson<Subject>(response);
      await loadSubjects();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "과목명을 수정하지 못했습니다.");
    }
  }

  async function handleDelete(subject: Subject) {
    if (!window.confirm(`'${subject.name}' 과목을 삭제하시겠습니까?`)) return;
    try {
      setError(null);
      const response = await fetch(`/api/subjects/${subject.id}`, { method: "DELETE" });
      await readJson<{ ok: true }>(response);
      await loadSubjects();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "과목을 삭제하지 못했습니다.");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.backLink} href="/">← 대시보드</Link>
        <h1>과목 관리</h1>
        <p>수행평가를 분류할 과목을 추가하고 이름을 변경하거나 삭제할 수 있습니다.</p>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.panel}>
        <h2>과목 추가</h2>
        <form className={styles.addForm} onSubmit={handleCreate}>
          <input
            name="name"
            required
            maxLength={100}
            placeholder="예: 화법과 언어"
            aria-label="과목명"
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="submit">추가</button>
        </form>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <h2>등록된 과목</h2>
          <span>{subjects.length}개</span>
        </div>
        {loading ? (
          <p className={styles.empty}>불러오는 중...</p>
        ) : subjects.length === 0 ? (
          <p className={styles.empty}>등록된 과목이 없습니다.</p>
        ) : (
          <div className={styles.subjectList}>
            {subjects.map((subject) => (
              <article className={styles.subjectRow} key={subject.id}>
                <strong>{subject.name}</strong>
                <div className={styles.actions}>
                  <button type="button" onClick={() => void handleRename(subject)}>이름 변경</button>
                  <button className={styles.danger} type="button" onClick={() => void handleDelete(subject)}>삭제</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
