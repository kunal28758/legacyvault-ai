import { z } from "zod";

import { parseQuery } from "@/lib/api/validate";
import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import { documentIdParamSchema } from "@/lib/validators/document.validators";

type IdParams = { id: string };

const querySchema = z.object({ versionId: z.uuid().optional() });

/**
 * A short-lived signed download link (FR-H007).
 *
 * The URL is returned in the body rather than as a redirect, so it never ends
 * up in a `Referer` header or a browser history entry. Authorisation happens
 * against the row before anything is signed, and the read is audited.
 */
export const GET = withApi<undefined, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema },
    auditAction: "document.accessed",
    auditResourceType: "document",
  },
  async ({ user, params, request, correlationId }) => {
    const query = parseQuery(new URL(request.url), querySchema);
    return documentService.accessDocument(
      user,
      params.id,
      { versionId: query.versionId, disposition: "attachment" },
      correlationId,
    );
  },
);
