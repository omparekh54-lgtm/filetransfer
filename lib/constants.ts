export const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024;
export const MAX_TRANSFER_BYTES = 50 * 1024 * 1024 * 1024;
export const MAX_FILES = 500;
export const MAX_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
export const MIN_EXPIRY_SECONDS = 60 * 60;

export const EXPIRY_OPTIONS = [
  { label: "1 hour", value: 60 * 60 },
  { label: "6 hours", value: 6 * 60 * 60 },
  { label: "24 hours", value: 24 * 60 * 60 },
  { label: "3 days", value: 3 * 24 * 60 * 60 },
  { label: "7 days", value: 7 * 24 * 60 * 60 },
] as const;
