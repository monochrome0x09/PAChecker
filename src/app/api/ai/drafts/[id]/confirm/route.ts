import { NextResponse } from "next/server";
import { AssessmentSubjectNotFoundError } from "@/lib/db/assessments";
import {
  AiDraftStateError,
  AiDraftValidationError,
  confirmAiDraft,
  SourceImageLinkedError,
  type ReviewAssessmentInput,
} from "@/lib/db/ai-drafts";

export const runtime = "nodejs";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function optionalText(
  value: unknown,
  fieldName: string,
): string | null | undefined {
  if (value === undefined || value === null || typeof value === "string") {
    return value;
  }
  throw new AiDraftValidationError(`${fieldName} must be a string or null`);
}

async function parseId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params;
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await parseId(params);
  if (!id) return NextResponse.json({ error: "Invalid draft id" }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!isObject(body)) return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });

  const rawCore = hasOwn(body, "reviewedCore")
    ? body.reviewedCore
    : hasOwn(body, "extractedCore")
      ? body.extractedCore
      : hasOwn(body, "core")
        ? body.core
        : body;
  if (!isObject(rawCore)) {
    return NextResponse.json({ error: "reviewedCore must be an object" }, { status: 400 });
  }

  const rawExtraFields = hasOwn(body, "extraFields") ? body.extraFields : {};
  if (!isObject(rawExtraFields)) {
    return NextResponse.json({ error: "extraFields must be an object" }, { status: 400 });
  }

  const rawNotificationOffsets = hasOwn(body, "notificationOffsets")
    ? body.notificationOffsets
    : [];
  if (!Array.isArray(rawNotificationOffsets)) {
    return NextResponse.json({ error: "notificationOffsets must be an array" }, { status: 400 });
  }

  try {
    const input: ReviewAssessmentInput = {
      subjectId: typeof rawCore.subjectId === "number" ? rawCore.subjectId : Number.NaN,
      title: typeof rawCore.title === "string" ? rawCore.title : "",
      assessmentDate: typeof rawCore.assessmentDate === "string" ? rawCore.assessmentDate : "",
      description: optionalText(rawCore.description, "description"),
      materials: optionalText(rawCore.materials, "materials"),
      status: rawCore.status as ReviewAssessmentInput["status"],
      extraFields: rawExtraFields,
      notificationOffsets: rawNotificationOffsets as number[],
    };
    const result = await confirmAiDraft(id, input);
    if (!result) return NextResponse.json({ error: "AI draft not found" }, { status: 404 });
    return NextResponse.json({ assessmentId: result.assessmentId }, { status: 201 });
  } catch (error) {
    if (error instanceof AiDraftValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof AssessmentSubjectNotFoundError) return NextResponse.json({ error: "Subject not found" }, { status: 400 });
    if (error instanceof AiDraftStateError || error instanceof SourceImageLinkedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Failed to confirm AI draft", error);
    return NextResponse.json({ error: "AI draft confirmation failed" }, { status: 500 });
  }
}
