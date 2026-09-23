import { z } from "zod";

/** Video legacy request shapes (FR-K001–K006). */
export const videoIdParamSchema = z.object({ id: z.uuid("Unknown video.") });
export const videoAssignmentParamSchema = z.object({
  id: z.uuid("Unknown video."),
  assignmentId: z.uuid("Unknown assignment."),
});

export const videoListQuerySchema = z.object({
  deliveryCondition: z.enum(["IMMEDIATE", "DEAD_MAN_SWITCH", "EMERGENCY_ACCESS"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const videoUpdateBodySchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    deliveryCondition: z.enum(["IMMEDIATE", "DEAD_MAN_SWITCH", "EMERGENCY_ACCESS"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: "custom", path: ["_"], message: "Provide at least one field." });
    }
  });

export const videoDeleteBodySchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this deletion to continue." }),
});

export const videoAssignBodySchema = z.object({
  beneficiaryId: z.uuid("Choose a beneficiary"),
  confirmed: z.literal(true, { error: "Confirm this assignment to continue." }),
});

export type VideoListQuery = z.infer<typeof videoListQuerySchema>;
export type VideoUpdateBody = z.infer<typeof videoUpdateBodySchema>;
export type VideoAssignBody = z.infer<typeof videoAssignBodySchema>;
