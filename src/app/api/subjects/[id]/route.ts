import { NextResponse } from "next/server";
import {
  deleteSubject,
  getSubject,
  SubjectNameConflictError,
  SubjectReferencedError,
  SubjectValidationError,
  updateSubject,
} from "@/lib/db/subjects";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function parseId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) {
    return null;
  }

  const parsed = Number(id);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(_request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid subject id" }, { status: 400 });
  }

  try {
    const subject = await getSubject(id);
    if (!subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }
    return NextResponse.json(subject);
  } catch (error) {
    if (error instanceof SubjectValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to get subject", error);
    return NextResponse.json({ error: "Subject request failed" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid subject id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!isObject(body) || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const subject = await updateSubject(id, body.name);
    if (!subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }
    return NextResponse.json(subject);
  } catch (error) {
    if (error instanceof SubjectValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SubjectNameConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Failed to update subject", error);
    return NextResponse.json({ error: "Subject request failed" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid subject id" }, { status: 400 });
  }

  try {
    const deleted = await deleteSubject(id);
    if (!deleted) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SubjectValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SubjectReferencedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Failed to delete subject", error);
    return NextResponse.json({ error: "Subject request failed" }, { status: 500 });
  }
}
