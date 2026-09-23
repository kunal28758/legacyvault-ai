import { withApi } from "@/lib/api/with-api";
import * as uploadService from "@/lib/services/upload.service";
import { uploadIdParamSchema } from "@/lib/validators/document.validators";

type UploadParams = { uploadId: string };

export const GET = withApi<undefined, undefined, UploadParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: uploadIdParamSchema },
    auditAction: "upload.read",
    auditResourceType: "upload_session",
  },
  async ({ user, params }) => uploadService.getUploadStatus(user, params.uploadId),
);
