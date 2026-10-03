import { withApi } from "@/lib/api/with-api";
import * as uploadService from "@/lib/services/upload.service";
import {
  uploadCompleteBodySchema,
  uploadIdParamSchema,
  type UploadCompleteBody,
} from "@/lib/validators/document.validators";

type UploadParams = { uploadId: string };

/**
 * Step 2 of the upload (ADR-005).
 *
 * Measures the object that actually arrived and checks its leading bytes
 * against the declared type, then calls `promote_upload()`. A rejected object
 * is deleted; one whose completion failed unexpectedly stays private and
 * unpromoted, and the upload may be completed again.
 *
 * Nothing here reads the whole file — a size lookup and a few-KB range read —
 * so the limit is short. `STALE_IN_PROGRESS_MS` in the upload service must stay
 * above it.
 */
export const maxDuration = 60;

export const POST = withApi<UploadCompleteBody, undefined, UploadParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: uploadIdParamSchema, body: uploadCompleteBodySchema },
    auditAction: "upload.completed",
    auditResourceType: "upload_session",
  },
  async ({ user, params, body, correlationId }) =>
    uploadService.completeUpload(user, params.uploadId, body, correlationId),
);
