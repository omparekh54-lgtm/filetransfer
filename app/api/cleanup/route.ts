import { del, get, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import type { TransferManifest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await list({ prefix: "transfers/", limit: 250, cursor });
    for (const blob of page.blobs) {
      const result = await get(blob.url, { access: "private", useCache: false });
      if (!result) continue;
      const manifest = (await new Response(result.stream).json()) as TransferManifest;
      if (Date.parse(manifest.expiresAt) <= Date.now()) {
        const partials = await list({ prefix: `files/${manifest.id}/`, limit: 1000 });
        const fileUrls = new Set([
          ...manifest.files.map((file) => file.blobUrl),
          ...partials.blobs.map((file) => file.url),
        ]);
        await del([...fileUrls, blob.url]);
        deleted += 1;
      }
    }
    cursor = page.cursor;
  } while (cursor);

  return NextResponse.json({ deleted });
}
