import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TRANSFER_BYTES } from "@/lib/constants";
import { tokenMatches } from "@/lib/security";
import { listTransferFiles, readManifest, writeManifest } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  ownerToken: z.string().min(20),
  files: z.array(z.object({
    name: z.string().min(1).max(255),
    relativePath: z.string().min(1).max(1024),
    pathname: z.string().min(1),
    size: z.number().int().nonnegative().max(MAX_FILE_BYTES),
    type: z.string().max(255),
  })).min(1).max(MAX_FILES),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid uploaded file list." }, { status: 400 });
  }

  const found = await readManifest(parsed.data.code);
  if (!found || !tokenMatches(parsed.data.ownerToken, found.manifest.ownerTokenHash)) {
    return NextResponse.json({ error: "Transfer not found." }, { status: 404 });
  }
  if (found.manifest.status !== "uploading" || Date.parse(found.manifest.expiresAt) <= Date.now()) {
    return NextResponse.json({ error: "This transfer can no longer be finalized." }, { status: 410 });
  }

  const total = parsed.data.files.reduce((sum, file) => sum + file.size, 0);
  if (
    total > MAX_TRANSFER_BYTES ||
    parsed.data.files.length !== found.manifest.expectedFileCount ||
    total !== found.manifest.expectedTotalBytes
  ) {
    return NextResponse.json({ error: "The uploaded files do not match this transfer." }, { status: 400 });
  }

  const blobs = await listTransferFiles(found.manifest.id);
  const byPath = new Map(blobs.map((blob) => [blob.pathname, blob]));
  const files = parsed.data.files.map((file) => {
    if (!file.pathname.startsWith(`files/${found.manifest.id}/`)) {
      throw new Error("Invalid file path.");
    }
    const blob = byPath.get(file.pathname);
    if (!blob || blob.size !== file.size) throw new Error("An uploaded file is missing or incomplete.");
    return { ...file, blobUrl: blob.url };
  });

  found.manifest.files = files;
  found.manifest.status = "ready";
  await writeManifest(found.manifest);

  return NextResponse.json({ code: found.manifest.code, expiresAt: found.manifest.expiresAt });
}
