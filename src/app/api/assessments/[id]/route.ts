import { NextResponse } from "next/server";
import {
  AssessmentReferencedError,
  AssessmentSubjectNotFoundError,
  AssessmentValidationError,
  deleteAssessment,
  getAssessment,
  isAssessmentStatus,
  isValidAssessmentDate,
  updateAssessment,
  updateAssessmentStatus,
  validateExtraFields,
  type CreateAssessmentInput,
  type UpdateAssessmentInput,
} from "@/lib/db/assessments";
import { listAssessmentSourceImages } from "@/lib/db/source-images";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) {
    return null;
  }

  const parsed = Number(id);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

type ParsedAssessmentInput =
  | { input: UpdateAssessmentInput }
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

function mutationError(error: unknown, operation: string): NextResponse {
  if (error instanceof AssessmentValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof AssessmentSubjectNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof AssessmentReferencedError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  console.error(`Failed to ${operation} assessment`, error);
  return NextResponse.json({ error: "Assessment request failed" }, { status: 500 });
}

async function updateStatus(request: Request, id: number): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!isObject(body) || !isAssessmentStatus(body.status)) {
    return NextResponse.json({ error: "status must be pending or completed" }, { status: 400 });
  }

  try {
    const updated = await updateAssessmentStatus(id, body.status);
    if (!updated) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationError(error, "update");
  }
}

export async function GET(_request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid assessment id" }, { status: 400 });
  }

  try {
    const assessment = await getAssessment(id);
    if (!assessment) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    const sourceImages = await listAssessmentSourceImages(id);
    return NextResponse.json({ ...assessment, sourceImages });
  } catch (error) {
    if (error instanceof AssessmentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to get assessment", error);
    return NextResponse.json({ error: "Assessment request failed" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid assessment id" }, { status: 400 });
  }

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
    const updated = await updateAssessment(id, parsed.input);
    if (!updated) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationError(error, "update");
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid assessment id" }, { status: 400 });
  }
  return updateStatus(request, id);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid assessment id" }, { status: 400 });
  }

  try {
    const deleted = await deleteAssessment(id);
    if (!deleted) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationError(error, "delete");
  }
}
