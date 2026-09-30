import { withApi } from "@/lib/api/with-api";
import * as uploadService from "@/lib/services/upload.service";
import {
  uploadCompleteBodySchema,
  uploadIdParamSchema,
  type UploadCompleteBody,
} from "@/lib/validators/document.validators";

type UploadParams = { uploadId: string };

/**
 * Step 2 of the upload (ADR-005, ADR-015).
 *
 * Measures the object that actually arrived, checks its leading bytes against
 * the declared type, runs the malware-scan boundary, and only then moves it out
 * of quarantine and calls `promote_upload()`. A rejected object is deleted; a
 * file whose scan could not run stays in quarantine and may be completed again.
 *
 * A 500 MB video has to be streamed through the scanner inside this request,
 * and the scan is bounded below this limit (`scanTimeoutFor`).
 */
export const maxDuration = 300;

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
