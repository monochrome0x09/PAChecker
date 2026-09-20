import { NextResponse } from "next/server";
import {
  createSubject,
  listSubjects,
  SubjectNameConflictError,
  SubjectValidationError,
} from "@/lib/db/subjects";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listSubjects());
  } catch (error) {
    console.error("Failed to list subjects", error);
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

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
  }

  const name = (body as { name?: unknown }).name;
  if (typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const subject = await createSubject(name);
    return NextResponse.json(subject, { status: 201 });
  } catch (error) {
    if (error instanceof SubjectValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SubjectNameConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Failed to create subject", error);
    return NextResponse.json({ error: "Subject request failed" }, { status: 500 });
  }
}
