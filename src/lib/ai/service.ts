import "server-only";

import {
  analyzeImageWithCliProxy,
} from "./cliproxy";
import type { StructuredAssessment } from "./schema";
import {
  ImageStorageValidationError,
  readImage,
  validateImageBytes,
} from "@/lib/storage";
import type { SourceImage } from "@/lib/db/ai-drafts";

export async function analyzeStoredSourceImage(
  sourceImage: SourceImage,
): Promise<StructuredAssessment> {
  const mimeType = sourceImage.mimeType;
  if (!mimeType) {
    throw new ImageStorageValidationError("Source image MIME type is missing");
  }

  const bytes = await readImage(sourceImage.storageKey);
  validateImageBytes(mimeType, bytes);
  return analyzeImageWithCliProxy(bytes, mimeType);
}
