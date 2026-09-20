"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type DraftResponse = { draft?: { id: number }; id?: number; error?: string };

export default function ImportAssessmentPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseFile(selected: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(selected ? URL.createObjectURL(selected) : null);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return setError("분석할 이미지를 선택해주세요.");
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("image", file);
      const response = await fetch("/api/ai/drafts", { method: "POST", body });
      const data = (await response.json()) as DraftResponse;
      if (!response.ok) throw new Error(data.error ?? "이미지 분석에 실패했습니다.");
      const id = data.draft?.id ?? data.id;
      if (!id) throw new Error("생성된 분석 초안을 확인하지 못했습니다.");
      router.push(`/assessments/import/${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이미지 분석에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/assessments">← 수행평가 목록</Link>
        <p>PACHECKER / AI IMPORT</p>
        <h1>수행평가지 이미지로 등록</h1>
        <span>원본 이미지는 보존되며, 분석 결과를 확인하고 수정한 뒤에만 저장됩니다.</span>
      </header>
      <form className={styles.card} onSubmit={submit} aria-busy={busy}>
        <label className={styles.dropzone} htmlFor="assessment-image">
          {preview ? (
            // Blob URLs are local previews and are not compatible with the Next image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="선택한 수행평가지 미리보기" />
          ) : (
            <span className={styles.dropzonePrompt}>
              <strong>사진을 선택하거나 촬영하세요</strong>
              <span>카메라로 촬영하거나 사진 보관함에서 선택할 수 있습니다.</span>
            </span>
          )}
          <input
            id="assessment-image"
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            aria-label="수행평가지 사진 촬영 또는 이미지 선택"
            aria-describedby={file ? "upload-help selected-file" : "upload-help"}
            disabled={busy}
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />
          <span id="upload-help">JPEG, PNG, WebP, GIF · 최대 10MB</span>
        </label>
        {file && <p className={styles.fileName} id="selected-file" aria-live="polite">선택한 파일: {file.name}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <Link href="/assessments/new">직접 등록</Link>
          <button disabled={!file || busy} type="submit">{busy ? "원본 저장 및 분석 중..." : "AI 분석 시작"}</button>
        </div>
      </form>
    </main>
  );
}
