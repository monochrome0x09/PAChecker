import { NextResponse } from "next/server";
import {
  AssessmentValidationError,
  isAssessmentStatus,
  updateAssessmentStatus,
} from "@/lib/db/assessments";

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

async function handleStatus(request: Request, { params }: RouteContext) {
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
    if (error instanceof AssessmentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to update assessment status", error);
    return NextResponse.json({ error: "Assessment request failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleStatus(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return handleStatus(request, context);
}
