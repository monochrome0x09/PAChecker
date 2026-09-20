import { NextResponse } from "next/server";
import { AiSchemaValidationError } from "@/lib/ai/schema";
import {
  AiConfigurationError,
  AiProviderError,
  AiResponseError,
} from "@/lib/ai/cliproxy";
import { analyzeStoredSourceImage } from "@/lib/ai/service";
import {
  createAiDraft,
  createFailedAiDraft,
  createSourceImage,
  deleteSourceImageIfUnlinked,
  type AiDraft,
  type SourceImage,
} from "@/lib/db/ai-drafts";
import {
  deleteImage,
  ImageStorageValidationError,
  StorageConfigurationError,
  saveImage,
  type StoredImage,
} from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

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

function isFilePart(value: FormDataEntryValue | null): value is File {
  return value !== null && typeof value !== "string" && typeof value.arrayBuffer === "function";
}

function isAnalysisFailure(error: unknown): boolean {
  return (
    error instanceof AiConfigurationError ||
    error instanceof AiProviderError ||
    error instanceof AiResponseError ||
    error instanceof AiSchemaValidationError
  );
}

async function cleanupUnlinkedSourceImage(sourceImage: SourceImage): Promise<void> {
  try {
    await deleteSourceImageIfUnlinked(sourceImage.id);
  } catch (error) {
    console.error("Failed to clean up source image metadata", error);
  }
  try {
    await deleteImage(sourceImage.storageKey);
  } catch (error) {
    console.error("Failed to clean up source image file", error);
  }
}

function uploadError(error: unknown): NextResponse {
  if (error instanceof ImageStorageValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof StorageConfigurationError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  console.error("Failed to upload source image", error);
  return NextResponse.json({ error: "Image upload request failed" }, { status: 500 });
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Request body must be multipart form data" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!isFilePart(file)) {
    return NextResponse.json({ error: "image file is required" }, { status: 400 });
  }

  let stored: StoredImage;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    stored = await saveImage(bytes, file.type, file.name);
  } catch (error) {
    return uploadError(error);
  }

  let sourceImage: SourceImage;
  try {
    sourceImage = await createSourceImage({
      storageKey: stored.storageKey,
      originalFilename: stored.originalFilename,
      mimeType: stored.mimeType,
    });
  } catch (error) {
    try {
      await deleteImage(stored.storageKey);
    } catch (cleanupError) {
      console.error("Failed to clean up stored image after metadata insert failure", cleanupError);
    }
    return uploadError(error);
  }

  let structured;
  try {
    structured = await analyzeStoredSourceImage(sourceImage);
  } catch (error) {
    if (!isAnalysisFailure(error)) {
      await cleanupUnlinkedSourceImage(sourceImage);
      console.error("Failed to read source image for analysis", error);
      return NextResponse.json({ error: "Source image analysis input failed" }, { status: 500 });
    }

    try {
      const draft = await createFailedAiDraft(
        sourceImage.id,
        error instanceof Error ? error.message : "AI analysis failed",
      );
      return NextResponse.json({ draft: publicDraft(draft) }, { status: 201 });
    } catch (draftError) {
      await cleanupUnlinkedSourceImage(sourceImage);
      console.error("Failed to save failed AI draft", draftError);
      return NextResponse.json({ error: "AI draft database request failed" }, { status: 500 });
    }
  }

  try {
    const draft = await createAiDraft(sourceImage.id, structured);
    return NextResponse.json({ draft: publicDraft(draft) }, { status: 201 });
  } catch (error) {
    await cleanupUnlinkedSourceImage(sourceImage);
    console.error("Failed to save AI draft", error);
    return NextResponse.json({ error: "AI draft database request failed" }, { status: 500 });
  }
}
