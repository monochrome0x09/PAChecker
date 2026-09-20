import { NextResponse } from "next/server";
import {
  getSourceImage,
  type SourceImage,
} from "@/lib/db/ai-drafts";
import {
  readImage,
  StoredImageNotFoundError,
} from "@/lib/storage";

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

function contentDisposition(sourceImage: SourceImage): string {
  const filename = sourceImage.originalFilename?.replace(/[\r\n"\\]/g, "_") || "assessment-image";
  return `inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const id = await parseId(params);
  if (id === null) {
    return NextResponse.json({ error: "Invalid source image id" }, { status: 400 });
  }

  let sourceImage: SourceImage | null;
  try {
    sourceImage = await getSourceImage(id);
  } catch (error) {
    console.error("Failed to get source image", error);
    return NextResponse.json({ error: "Source image request failed" }, { status: 500 });
  }
  if (!sourceImage) {
    return NextResponse.json({ error: "Source image not found" }, { status: 404 });
  }

  try {
    const bytes = await readImage(sourceImage.storageKey);
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(sourceImage),
      "Content-Length": String(bytes.byteLength),
    });
    if (sourceImage.mimeType) {
      headers.set("Content-Type", sourceImage.mimeType);
    }
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(body, { headers });
  } catch (error) {
    if (error instanceof StoredImageNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Failed to read source image", error);
    return NextResponse.json({ error: "Source image request failed" }, { status: 500 });
  }
}
