import { del, get, head, list, put } from "@vercel/blob";
import type { TransferManifest } from "@/lib/types";

const manifestPath = (code: string) => `transfers/${code}.json`;

export function blobToken() {
  return process.env.FILETRANSFER_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
}

export function storageConfigured() {
  return Boolean(blobToken() || process.env.VERCEL_OIDC_TOKEN);
}

export async function findManifestBlob(code: string) {
  const result = await get(manifestPath(code), {
    access: "private",
    useCache: false,
    token: blobToken(),
  });
  return result?.statusCode === 200 ? result.blob : null;
}

export async function readManifest(code: string) {
  const result = await get(manifestPath(code), {
    access: "private",
    useCache: false,
    token: blobToken(),
  });
  if (!result || result.statusCode !== 200) return null;
  const manifest = (await new Response(result.stream).json()) as TransferManifest;
  return { manifest, manifestUrl: result.blob.url };
}

export async function writeManifest(manifest: TransferManifest) {
  return put(manifestPath(manifest.code), JSON.stringify(manifest), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 0,
    token: blobToken(),
  });
}

export async function deleteTransferBlobs(manifest: TransferManifest, manifestUrl?: string) {
  const urls = manifest.files.map((file) => file.blobUrl);
  if (manifestUrl) urls.push(manifestUrl);
  if (urls.length) await del(urls, { token: blobToken() });
}

export async function listTransferFiles(id: string) {
  const result = await list({ prefix: `files/${id}/`, limit: 1000, token: blobToken() });
  return result.blobs;
}

export async function headTransferFile(pathname: string) {
  return head(pathname, { token: blobToken() });
}

export async function cleanupExpiredTransfers(limit = 20) {
  const page = await list({ prefix: "transfers/", limit, token: blobToken() });
  let deleted = 0;

  for (const blob of page.blobs) {
    const result = await get(blob.url, {
      access: "private",
      useCache: false,
      token: blobToken(),
    });
    if (!result) continue;

    const manifest = (await new Response(result.stream).json()) as TransferManifest;
    if (Date.parse(manifest.expiresAt) > Date.now()) continue;

    const partials = await list({
      prefix: `files/${manifest.id}/`,
      limit: 1000,
      token: blobToken(),
    });
    const urls = new Set([
      ...manifest.files.map((file) => file.blobUrl),
      ...partials.blobs.map((file) => file.url),
      blob.url,
    ]);
    await del([...urls], { token: blobToken() });
    deleted += 1;
  }

  return deleted;
}
