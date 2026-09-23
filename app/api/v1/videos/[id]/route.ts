import { withApi } from "@/lib/api/with-api";
import * as videoService from "@/lib/services/video.service";
import {
  videoDeleteBodySchema,
  videoIdParamSchema,
  videoUpdateBodySchema,
  type VideoUpdateBody,
} from "@/lib/validators/video.validators";

type IdParams = { id: string };
type DeleteBody = { confirmed: true };

export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: videoIdParamSchema },
    auditAction: "video.read",
    auditResourceType: "video_message",
  },
  async ({ user, params }) => videoService.getVideo(user, params.id),
);

/** Title, description and delivery condition — the Class A allow-list. */
export const PATCH = withApi<VideoUpdateBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: videoIdParamSchema, body: videoUpdateBodySchema },
    auditAction: "video.updated",
    auditResourceType: "video_message",
  },
  async ({ user, params, body, correlationId }) =>
    videoService.updateVideo(user, params.id, body, correlationId),
);

export const DELETE = withApi<DeleteBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: videoIdParamSchema, body: videoDeleteBodySchema },
    auditAction: "video.deleted",
    auditResourceType: "video_message",
  },
  async ({ user, params, correlationId }) =>
    videoService.deleteVideo(user, params.id, correlationId),
);
