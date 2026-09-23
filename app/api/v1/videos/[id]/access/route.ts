import { withApi } from "@/lib/api/with-api";
import * as videoService from "@/lib/services/video.service";
import { videoIdParamSchema } from "@/lib/validators/video.validators";

type IdParams = { id: string };

/** A short-lived signed link so the owner can review their own recording. */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: videoIdParamSchema },
    auditAction: "video.accessed",
    auditResourceType: "video_message",
  },
  async ({ user, params, correlationId }) =>
    videoService.accessVideo(user, params.id, correlationId),
);
