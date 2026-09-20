import { NextResponse } from "next/server";
import {
  AssessmentSubjectNotFoundError,
  AssessmentValidationError,
  createAssessment,
  isAssessmentStatus,
  isValidAssessmentDate,
  listAssessments,
  validateExtraFields,
  type CreateAssessmentInput,
} from "@/lib/db/assessments";

export const runtime = "nodejs";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ParsedAssessmentInput =
  | { input: CreateAssessmentInput }
  | { error: string };

function parseAssessmentInput(body: Record<string, unknown>): ParsedAssessmentInput {
  if (!Number.isInteger(body.subjectId) || (body.subjectId as number) <= 0) {
    return { error: "subjectId must be a positive integer" };
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return { error: "title is required" };
  }
  if (typeof body.assessmentDate !== "string") {
    return { error: "assessmentDate is required" };
  }
  if (!isValidAssessmentDate(body.assessmentDate)) {
    return { error: "assessmentDate must be a real calendar date in YYYY-MM-DD format" };
  }

  for (const field of ["description", "materials"] as const) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return { error: `${field} must be a string or null` };
    }
  }

  if (body.status !== undefined && !isAssessmentStatus(body.status)) {
    return { error: "status must be pending or completed" };
  }

  if (body.extraFields !== undefined) {
    try {
      validateExtraFields(body.extraFields);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid extraFields",
      };
    }
  }

  return {
    input: {
      subjectId: body.subjectId as number,
      title: body.title,
      assessmentDate: body.assessmentDate,
      description: body.description as string | null | undefined,
      materials: body.materials as string | null | undefined,
      status: body.status as CreateAssessmentInput["status"],
      extraFields: body.extraFields as Record<string, unknown> | undefined,
    },
  };
}

export async function GET() {
  try {
    return NextResponse.json(await listAssessments());
  } catch (error) {
    console.error("Failed to list assessments", error);
    return NextResponse.json({ error: "Database request failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!isObject(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const parsed = parseAssessmentInput(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const id = await createAssessment(parsed.input);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof AssessmentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AssessmentSubjectNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to create assessment", error);
    return NextResponse.json({ error: "Assessment request failed" }, { status: 500 });
  }
}
