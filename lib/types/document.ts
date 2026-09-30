import type { Database } from "@/lib/types/database";

/**
 * Document, folder and upload view models shared by the server and browser.
 *
 * Storage keys and bucket names are never part of these shapes: the browser has
 * no business knowing where an object lives, and a leaked key plus a future
 * storage misconfiguration is exactly the pair that turns into a data breach.
 * Access is always a freshly signed, short-lived URL.
 */
export type ScanStatus = Database["public"]["Enums"]["scan_status"];
export type UploadStatus = Database["public"]["Enums"]["upload_status"];
export type UploadKind = Database["public"]["Enums"]["upload_kind"];
export type AttachmentResourceType = Database["public"]["Enums"]["attachment_resource_type"];

/** What the malware-scan boundary actually did (ADR-015). */
export interface ScanInfo {
  status: ScanStatus;
  /** False when no scanner was configured — the file was not inspected. */
  performed: boolean;
  provider: string | null;
  scannedAt: string | null;
}

export interface DocumentSummary {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string | null;
  scan: ScanInfo;
  versionCount: number;
  /** How many beneficiaries this document is shared with. */
  shareCount: number;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  sizeBytes: number;
  createdAt: string;
  isCurrent: boolean;
}

export interface DocumentAttachmentSummary {
  id: string;
  resourceType: AttachmentResourceType;
  resourceId: string;
  createdAt: string;
}

export interface DocumentShare {
  assignmentId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  createdAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  versions: DocumentVersionSummary[];
  attachments: DocumentAttachmentSummary[];
  shares: DocumentShare[];
}

export interface DocumentListResult {
  items: DocumentSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface FolderSummary {
  id: string;
  name: string;
  parentId: string | null;
  documentCount: number;
  createdAt: string;
}

/** Handed to the browser so it can PUT the bytes; it never sees the final path. */
export interface UploadTicket {
  uploadId: string;
  uploadUrl: string;
  token: string;
  expiresAt: string;
  declaredName: string;
  maxBytes: number;
}

export interface UploadOutcome {
  uploadId: string;
  status: UploadStatus;
  rejectionReason: string | null;
  scan: ScanInfo;
  /**
   * True when the file is still safely held in quarantine and completing the
   * upload again may succeed — the scanner was unavailable, or a step timed
   * out. Never true for a rejected or infected file.
   */
  retryable: boolean;
  /** True while another request is still validating or scanning this upload. */
  inProgress: boolean;
  documentId?: string;
  videoId?: string;
}

/** A signed, expiring link to one object. */
export interface SignedAccess {
  url: string;
  expiresAt: string;
  name: string;
  mimeType: string;
}
