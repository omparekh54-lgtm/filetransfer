import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { MAX_FILE_BYTES } from "@/lib/constants";
import { blobToken, readManifest } from "@/lib/storage";
import { tokenMatches } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClientPayload = { code: string; ownerToken: string };

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const response = await handleUpload({
      token: blobToken(),
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = JSON.parse(clientPayload || "{}") as ClientPayload;
        const found = await readManifest(payload.code);

        if (
          !found ||
          found.manifest.status !== "uploading" ||
          Date.parse(found.manifest.expiresAt) <= Date.now() ||
          !tokenMatches(payload.ownerToken || "", found.manifest.ownerTokenHash) ||
          !pathname.startsWith(`files/${found.manifest.id}/`)
        ) {
          throw new Error("This upload is not authorized.");
        }

        return {
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ code: payload.code }),
        };
      },
      onUploadCompleted: async () => {
        // The sender finalizes the complete manifest after all parallel uploads finish.
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error("[upload-token] Failed to authorize upload", error);
    const message = error instanceof Error ? error.message : "Upload authorization failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
