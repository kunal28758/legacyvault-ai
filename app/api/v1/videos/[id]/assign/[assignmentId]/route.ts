import { withApi } from "@/lib/api/with-api";
import * as videoService from "@/lib/services/video.service";
import { videoAssignmentParamSchema } from "@/lib/validators/video.validators";

type AssignmentParams = { id: string; assignmentId: string };

export const DELETE = withApi<undefined, undefined, AssignmentParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: videoAssignmentParamSchema },
    auditAction: "assignment.removed",
    auditResourceType: "video_message",
  },
  async ({ user, params, correlationId }) =>
    videoService.unassignVideo(user, params.id, params.assignmentId, correlationId),
);
