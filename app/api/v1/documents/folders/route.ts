import { withApi } from "@/lib/api/with-api";
import * as folderService from "@/lib/services/folder.service";
import {
  folderCreateBodySchema,
  type FolderCreateBody,
} from "@/lib/validators/document.validators";

export const GET = withApi(
  {
    auth: "user",
    rateLimit: "default",
    auditAction: "folder.listed",
    auditResourceType: "folder",
  },
  async ({ user }) => folderService.listFolders(user),
);

export const POST = withApi<FolderCreateBody>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { body: folderCreateBodySchema },
    auditAction: "folder.created",
    auditResourceType: "folder",
  },
  async ({ user, body, correlationId }) => folderService.createFolder(user, body, correlationId),
);
