import type { DocumentProfile } from "@/lib/types/document-profile";
import type { Database } from "@/lib/types/database";

/**
 * Document, folder and upload view models shared by the server and browser.
 *
 * Storage keys and bucket names are never part of these shapes: the browser has
 * no business knowing where an object lives, and a leaked key plus a future
 * storage misconfiguration is exactly the pair that turns into a data breach.
 * Access is always a freshly signed, short-lived URL.
 */
export type UploadStatus = Database["public"]["Enums"]["upload_status"];
export type UploadKind = Database["public"]["Enums"]["upload_kind"];
export type AttachmentResourceType = Database["public"]["Enums"]["attachment_resource_type"];

export interface DocumentSummary {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string | null;
  versionCount: number;
  /** How many beneficiaries this document is shared with. */
  shareCount: number;
  /** Assets (or the plan) this document supports — the owner's own links only. */
  attachments: DocumentAttachmentSummary[];
  currentVersionId: string | null;
  /** Owner-set category and dates; null until the owner adds them. */
  profile: DocumentProfile | null;
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
  /**
   * True when the uploaded bytes are still held privately and completing the
   * upload again may succeed — a step failed unexpectedly or timed out. Never
   * true for a rejected file.
   */
  retryable: boolean;
  /** True while another request is still checking and saving this upload. */
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
