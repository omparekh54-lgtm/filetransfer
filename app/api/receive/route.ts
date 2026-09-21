import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientAddress } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { blobToken, deleteTransferBlobs, readManifest } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  const ip = clientAddress(request);
  const limited = rateLimit(`receive:${ip}`, 10, 10 * 60 * 1000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many code attempts. Please wait and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid six-digit code." }, { status: 400 });
  }

  const found = await readManifest(parsed.data.code);
  if (!found || found.manifest.status !== "ready") {
    return NextResponse.json({ error: "Transfer not found or unavailable." }, { status: 404 });
  }
  if (Date.parse(found.manifest.expiresAt) <= Date.now()) {
    await deleteTransferBlobs(found.manifest, found.manifestUrl).catch(() => undefined);
    return NextResponse.json({ error: "This transfer has expired." }, { status: 410 });
  }

  const validUntil = Math.min(Date.now() + 15 * 60 * 1000, Date.parse(found.manifest.expiresAt));
  const files = await Promise.all(found.manifest.files.map(async (file) => {
    const token = await issueSignedToken({
      pathname: file.pathname,
      operations: ["get"],
      validUntil,
      token: blobToken(),
    });
    const { presignedUrl } = await presignUrl(token, {
      operation: "get",
      pathname: file.pathname,
      access: "private",
      validUntil,
    });
    return {
      name: file.name,
      relativePath: file.relativePath,
      size: file.size,
      type: file.type,
      downloadUrl: presignedUrl,
    };
  }));

  return NextResponse.json({
    code: found.manifest.code,
    expiresAt: found.manifest.expiresAt,
    totalBytes: found.manifest.expectedTotalBytes,
    files,
  });
}
