import { z } from "zod";

/**
 * Operator request shapes (FR-P002–P007).
 *
 * Deliberately narrow: an operator surface that accepts free-form filters is a
 * query engine over everyone's data, so the only inputs here are a search
 * string, a page, and the enumerations the platform already uses.
 */
export const adminUserIdParamSchema = z.object({ id: z.uuid("Unknown user.") });
export const adminTokenIdParamSchema = z.object({ id: z.uuid("Unknown link.") });

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().min(1).max(160).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminAuditQuerySchema = z.object({
  actorId: z.uuid().optional(),
  /** Matched as a prefix, so `dms.` returns the whole domain. */
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]+$/, "Use an action prefix such as `access.` or `dms.`")
    .max(60)
    .optional(),
  outcome: z.enum(["SUCCESS", "FAILURE", "DENIED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

export const adminRoleBodySchema = z.object({
  role: z.enum(["USER", "SUPER_ADMIN"]),
  confirmed: z.literal(true, { error: "Confirm this role change to continue." }),
});

export const adminActionBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this action to continue." }),
});

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;
export type AdminAnalyticsQuery = z.infer<typeof adminAnalyticsQuerySchema>;
export type AdminRoleBody = z.infer<typeof adminRoleBodySchema>;
export type AdminActionBody = z.infer<typeof adminActionBodySchema>;
