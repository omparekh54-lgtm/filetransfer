import { del, get, list, put } from "@vercel/blob";
import type { TransferManifest } from "@/lib/types";

const manifestPath = (code: string) => `transfers/${code}.json`;

export function storageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN);
}

export async function findManifestBlob(code: string) {
  const result = await list({ prefix: manifestPath(code), limit: 2 });
  return result.blobs.find((blob) => blob.pathname === manifestPath(code)) ?? null;
}

export async function readManifest(code: string) {
  const blob = await findManifestBlob(code);
  if (!blob) return null;
  const result = await get(blob.url, { access: "private", useCache: false });
  if (!result) return null;
  const manifest = (await new Response(result.stream).json()) as TransferManifest;
  return { manifest, manifestUrl: blob.url };
}

export async function writeManifest(manifest: TransferManifest) {
  return put(manifestPath(manifest.code), JSON.stringify(manifest), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 0,
  });
}

export async function deleteTransferBlobs(manifest: TransferManifest, manifestUrl?: string) {
  const urls = manifest.files.map((file) => file.blobUrl);
  if (manifestUrl) urls.push(manifestUrl);
  if (urls.length) await del(urls);
}

export async function listTransferFiles(id: string) {
  const result = await list({ prefix: `files/${id}/`, limit: 1000 });
  return result.blobs;
}
