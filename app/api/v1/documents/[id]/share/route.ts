import { withApi } from "@/lib/api/with-api";
import * as documentService from "@/lib/services/document.service";
import {
  documentIdParamSchema,
  documentShareBodySchema,
  type DocumentShareBody,
} from "@/lib/validators/document.validators";

type IdParams = { id: string };

/**
 * Share a document with a beneficiary.
 *
 * A share is a `beneficiary_assignments` row with `resourceType = DOCUMENT`, so
 * it goes through `assign_beneficiary()` and inherits its ownership and
 * beneficiary-status checks. Documents carry no allocation percentage.
 *
 * The share then emails the beneficiary a link that follows their shares
 * (migration 0007); `accessEmailSent` reports whether it went out. A failed
 * email never undoes the share.
 */
export const POST = withApi<DocumentShareBody, undefined, IdParams>(
  {
    auth: "user",
    rateLimit: "default",
    schema: { params: documentIdParamSchema, body: documentShareBodySchema },
    auditAction: "document.shared",
    auditResourceType: "document",
  },
  async ({ user, params, body, correlationId }) =>
    documentService.shareDocument(user, params.id, body.beneficiaryId, correlationId),
);
