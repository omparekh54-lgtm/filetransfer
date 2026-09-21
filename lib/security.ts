import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function createOwnerToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function tokenMatches(value: string, expectedHash: string) {
  const actual = Buffer.from(hashToken(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSixDigitCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function sanitizeFilename(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\\/\0<>:"|?*\x00-\x1F]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180) || "file";
}

export function clientAddress(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
