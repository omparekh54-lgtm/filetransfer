import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_EXPIRY_SECONDS,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TRANSFER_BYTES,
  MIN_EXPIRY_SECONDS,
} from "@/lib/constants";
import { clientAddress, createOwnerToken, createSixDigitCode, hashToken } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { findManifestBlob, storageConfigured, writeManifest } from "@/lib/storage";
import type { TransferManifest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  expirySeconds: z.number().int().min(MIN_EXPIRY_SECONDS).max(MAX_EXPIRY_SECONDS),
  files: z.array(z.object({
    name: z.string().min(1).max(255),
    relativePath: z.string().min(1).max(1024),
    size: z.number().int().nonnegative().max(MAX_FILE_BYTES),
    type: z.string().max(255),
  })).min(1).max(MAX_FILES),
});

export async function POST(request: Request) {
  if (!storageConfigured()) {
    return NextResponse.json({ error: "Storage is not connected yet." }, { status: 503 });
  }

  const ip = clientAddress(request);
  const limited = rateLimit(`create:${ip}`, 12, 60 * 60 * 1000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many transfers created. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid transfer details." }, { status: 400 });
  }

  const totalBytes = parsed.data.files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TRANSFER_BYTES) {
    return NextResponse.json({ error: "This transfer is larger than 50 GB." }, { status: 413 });
  }

  let code = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = createSixDigitCode();
    if (!(await findManifestBlob(candidate))) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    return NextResponse.json({ error: "Could not reserve a transfer code. Try again." }, { status: 503 });
  }

  const ownerToken = createOwnerToken();
  const now = Date.now();
  const manifest: TransferManifest = {
    version: 1,
    id: randomUUID(),
    code,
    ownerTokenHash: hashToken(ownerToken),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + parsed.data.expirySeconds * 1000).toISOString(),
    status: "uploading",
    expectedFileCount: parsed.data.files.length,
    expectedTotalBytes: totalBytes,
    files: [],
  };

  await writeManifest(manifest);
  return NextResponse.json({
    id: manifest.id,
    code,
    ownerToken,
    expiresAt: manifest.expiresAt,
  });
}
