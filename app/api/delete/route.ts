import { NextResponse } from "next/server";
import { z } from "zod";
import { tokenMatches } from "@/lib/security";
import { del } from "@vercel/blob";
import { blobToken, listTransferFiles, readManifest } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
  ownerToken: z.string().min(20),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const found = await readManifest(parsed.data.code);
  if (!found || !tokenMatches(parsed.data.ownerToken, found.manifest.ownerTokenHash)) {
    return NextResponse.json({ error: "Transfer not found." }, { status: 404 });
  }

  const partials = await listTransferFiles(found.manifest.id);
  const urls = new Set([
    ...partials.map((blob) => blob.url),
    ...found.manifest.files.map((file) => file.blobUrl),
    found.manifestUrl,
  ]);
  await del([...urls], { token: blobToken() });
  return NextResponse.json({ deleted: true });
}
