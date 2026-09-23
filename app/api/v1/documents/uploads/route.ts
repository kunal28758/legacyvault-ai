import { withApi } from "@/lib/api/with-api";
import * as uploadService from "@/lib/services/upload.service";
import {
  uploadSessionBodySchema,
  type UploadSessionBody,
} from "@/lib/validators/document.validators";

/**
 * Step 1 of the upload (ADR-005).
 *
 * Validates what the browser claims about the file and returns a signed URL
 * into the private quarantine bucket. The object key is derived server-side, so
 * a crafted filename cannot choose where the bytes land.
 */
export const POST = withApi<UploadSessionBody>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: uploadSessionBodySchema },
    auditAction: "upload.session_created",
    auditResourceType: "upload_session",
  },
  async ({ user, body, correlationId }) =>
    uploadService.createUploadSession(user, body, correlationId),
);
