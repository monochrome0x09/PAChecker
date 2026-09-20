import { NextResponse } from "next/server";
import { AiSchemaValidationError, validateStructuredAssessment } from "@/lib/ai/schema";
import {
  AiDraftStateError,
  AiDraftValidationError,
  deleteAiDraft,
  getAiDraft,
  updateAiDraft,
  type AiDraft,
} from "@/lib/db/ai-drafts";
import { deleteImage } from "@/lib/storage";

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

function publicDraft(draft: AiDraft) {
  return {
    id: draft.id,
    sourceImageId: draft.sourceImageId,
    sourceImageUrl: `/api/uploads/${draft.sourceImageId}`,
    status: draft.status,
    extractedCore: draft.extractedCore,
    extraFields: draft.extraFields,
    ...(draft.errorMessage ? { errorMessage: draft.errorMessage } : {}),
  };
}

function validationError(error: unknown): NextResponse | null {
  if (error instanceof AiDraftValidationError || error instanceof AiSchemaValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof AiDraftStateError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return null;
}

function reviewedStructure(
  body: Record<string, unknown>,
  current: AiDraft,
) {
  const rawCore = body.extractedCore ?? body.reviewedCore ?? body.core ?? (
    body.title !== undefined || body.assessmentDate !== undefined
      ? body
      : current.extractedCore
  );
  const rawExtraFields = body.extraFields === undefined
    ? current.extraFields
    : body.extraFields;
  if (!isObject(rawCore)) {
    throw new AiDraftValidationError("extractedCore is required");
  }
  return validateStructuredAssessment({ core: rawCore, extraFields: rawExtraFields });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid draft id" }, { status: 400 });
  }

  try {
    const draft = await getAiDraft(id);
    if (!draft) {
      return NextResponse.json({ error: "AI draft not found" }, { status: 404 });
    }
    return NextResponse.json({ draft: publicDraft(draft) });
  } catch (error) {
    console.error("Failed to get AI draft", error);
    return NextResponse.json({ error: "AI draft request failed" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid draft id" }, { status: 400 });
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

  try {
    const current = await getAiDraft(id);
    if (!current) {
      return NextResponse.json({ error: "AI draft not found" }, { status: 404 });
    }
    const structured = reviewedStructure(body, current);
    const draft = await updateAiDraft(id, structured);
    if (!draft) {
      return NextResponse.json({ error: "AI draft not found" }, { status: 404 });
    }
    return NextResponse.json({ draft: publicDraft(draft) });
  } catch (error) {
    const response = validationError(error);
    if (response) {
      return response;
    }
    console.error("Failed to update AI draft", error);
    return NextResponse.json({ error: "AI draft request failed" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid draft id" }, { status: 400 });
  }

  try {
    const result = await deleteAiDraft(id);
    if (!result.deleted) {
      return NextResponse.json({ error: "AI draft not found" }, { status: 404 });
    }
    if (result.sourceImageStorageKey) {
      try {
        await deleteImage(result.sourceImageStorageKey);
      } catch (error) {
        console.error("Failed to remove unlinked source image file", error);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = validationError(error);
    if (response) {
      return response;
    }
    console.error("Failed to delete AI draft", error);
    return NextResponse.json({ error: "AI draft request failed" }, { status: 500 });
  }
}
