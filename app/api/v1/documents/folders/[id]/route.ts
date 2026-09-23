import { withApi } from "@/lib/api/with-api";
import * as folderService from "@/lib/services/folder.service";
import {
  folderDeleteBodySchema,
  folderIdParamSchema,
  folderUpdateBodySchema,
  type FolderUpdateBody,
} from "@/lib/validators/document.validators";

type IdParams = { id: string };
type DeleteBody = { confirmed: true };

export const PATCH = withApi<FolderUpdateBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: folderIdParamSchema, body: folderUpdateBodySchema },
    auditAction: "folder.updated",
    auditResourceType: "folder",
  },
  async ({ user, params, body, correlationId }) =>
    folderService.updateFolder(user, params.id, body, correlationId),
);

/** Soft delete; the documents inside move back to the root rather than vanish. */
export const DELETE = withApi<DeleteBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: folderIdParamSchema, body: folderDeleteBodySchema },
    auditAction: "folder.deleted",
    auditResourceType: "folder",
  },
  async ({ user, params, correlationId }) =>
    folderService.deleteFolder(user, params.id, correlationId),
);
