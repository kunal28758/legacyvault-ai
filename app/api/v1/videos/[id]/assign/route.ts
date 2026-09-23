import { withApi } from "@/lib/api/with-api";
import * as videoService from "@/lib/services/video.service";
import {
  videoAssignBodySchema,
  videoIdParamSchema,
  type VideoAssignBody,
} from "@/lib/validators/video.validators";

type IdParams = { id: string };

/**
 * Assigns a video to a beneficiary.
 *
 * Assignment makes the video eligible for a link's scope; whether a given link
 * may actually play it is decided by the video's delivery condition when the
 * token is minted (`lv_video_allowed`).
 */
export const POST = withApi<VideoAssignBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: videoIdParamSchema, body: videoAssignBodySchema },
    auditAction: "assignment.created",
    auditResourceType: "video_message",
  },
  async ({ user, params, body, correlationId }) =>
    videoService.assignVideo(user, params.id, body.beneficiaryId, correlationId),
);
