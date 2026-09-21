export type TransferStatus = "uploading" | "ready" | "deleted";

export type TransferFile = {
  name: string;
  relativePath: string;
  pathname: string;
  blobUrl: string;
  size: number;
  type: string;
};

export type TransferManifest = {
  version: 1;
  id: string;
  code: string;
  ownerTokenHash: string;
  createdAt: string;
  expiresAt: string;
  status: TransferStatus;
  expectedFileCount: number;
  expectedTotalBytes: number;
  files: TransferFile[];
};
