import { z } from "zod";

import { documentProfileSchema } from "@/lib/validators/document-profile";

/**
 * Document, folder and upload request shapes (FR-H001–H010).
 *
 * Everything the browser declares about a file is re-checked server-side, and
 * again against the bytes that actually arrive — these schemas are the first of
 * those three gates, not the only one.
 */
export const documentIdParamSchema = z.object({ id: z.uuid("Unknown document.") });
export const folderIdParamSchema = z.object({ id: z.uuid("Unknown folder.") });
export const uploadIdParamSchema = z.object({ uploadId: z.uuid("Unknown upload.") });

export const documentShareParamSchema = z.object({
  id: z.uuid("Unknown document."),
  beneficiaryId: z.uuid("Unknown beneficiary."),
});

export const documentAttachmentParamSchema = z.object({
  id: z.uuid("Unknown document."),
  attachmentId: z.uuid("Unknown attachment."),
});

export const documentListQuerySchema = z.object({
  folderId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const documentUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200).optional(),
    folderId: z.uuid().nullable().optional(),
    /** Category and dates, stored in the owner-writable `metadata` (see lib/validators/document-profile). */
    profile: documentProfileSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: "custom", path: ["_"], message: "Provide at least one field." });
    }
  });

export const documentDeleteBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this deletion to continue." }),
});

/**
 * An upload session request. `sizeBytes` is what the browser claims; the object
 * is measured again once it lands, and a mismatch rejects the upload.
 */
export const uploadSessionBodySchema = z.object({
  kind: z.enum(["DOCUMENT", "DOCUMENT_VERSION", "VIDEO"]),
  name: z.string().trim().min(1, "Give the file a name").max(255),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().positive(),
  folderId: z.uuid().nullable().optional(),
  documentId: z.uuid().optional(),
});

export const uploadCompleteBodySchema = z.object({
  /** Video-only metadata, applied by `promote_upload()`. */
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  deliveryCondition: z.enum(["IMMEDIATE", "DEAD_MAN_SWITCH", "EMERGENCY_ACCESS"]).optional(),
});

export const folderCreateBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  parentId: z.uuid().nullable().optional(),
});

export const folderUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    parentId: z.uuid().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: "custom", path: ["_"], message: "Provide at least one field." });
    }
  });

export const folderDeleteBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this deletion to continue." }),
});

export const documentAttachBodySchema = z.object({
  resourceType: z.enum(["FINANCIAL_ASSET", "PHYSICAL_ASSET", "DIGITAL_ASSET", "LEGACY_PLAN"]),
  resourceId: z.uuid("Unknown resource."),
});

export const documentShareBodySchema = z.object({
  beneficiaryId: z.uuid("Choose a beneficiary"),
  confirmed: z.literal(true, { error: "Confirm this share to continue." }),
});

export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export type DocumentUpdateBody = z.infer<typeof documentUpdateBodySchema>;
export type UploadSessionBody = z.infer<typeof uploadSessionBodySchema>;
export type UploadCompleteBody = z.infer<typeof uploadCompleteBodySchema>;
export type FolderCreateBody = z.infer<typeof folderCreateBodySchema>;
export type FolderUpdateBody = z.infer<typeof folderUpdateBodySchema>;
export type DocumentAttachBody = z.infer<typeof documentAttachBodySchema>;
export type DocumentShareBody = z.infer<typeof documentShareBodySchema>;
