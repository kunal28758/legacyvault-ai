import { withApi } from "@/lib/api/with-api";
import * as videoService from "@/lib/services/video.service";
import { videoListQuerySchema, type VideoListQuery } from "@/lib/validators/video.validators";

/** Video legacy messages (api-contracts.md § Video Legacy). */
export const GET = withApi<undefined, VideoListQuery>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { query: videoListQuerySchema },
    auditAction: "video.listed",
    auditResourceType: "video_message",
  },
  async ({ user, query }) => videoService.listVideos(user, query),
);
