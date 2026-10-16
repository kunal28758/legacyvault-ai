import { z } from "zod";

import { lifeEventsSchema } from "@/lib/validators/life-event.validators";

/**
 * User profile schemas (task T034).
 *
 * Password, email and name are *not* here: Clerk owns those and enforces the
 * policy from the T195 checklist (FR-A002). This file covers only app-owned
 * profile data.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date");

export const addressSchema = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(80).optional(),
});

export const familyInfoSchema = z.object({
  maritalStatus: z.enum(["single", "married", "partnered", "divorced", "widowed"]).optional(),
  spouseName: z.string().trim().max(120).optional(),
  children: z
    .array(z.object({ name: z.string().trim().min(1).max(120), dateOfBirth: isoDate.optional() }))
    .max(20)
    .optional(),
  dependents: z.string().trim().max(600).optional(),
});

export const updateProfileSchema = z
  .object({
    dateOfBirth: isoDate.nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    alternateEmail: z.email("Enter a valid email address").nullable().optional(),
    address: addressSchema.nullable().optional(),
    familyInfo: familyInfoSchema.nullable().optional(),
  })
  .strict();

/** Idle sign-out choices (FR-B006); `null` disables it. */
export const securityPreferencesSchema = z
  .object({
    idleTimeoutMinutes: z
      .union([z.literal(15), z.literal(30), z.literal(60), z.literal(240), z.null()])
      .optional(),
    loginNotifications: z.boolean().optional(),
    securityReviewReminder: z.boolean().optional(),
  })
  .strict();

export const notificationPreferencesSchema = z
  .object({
    email: z.boolean().optional(),
    securityAlerts: z.boolean().optional(),
    checkInReminders: z.boolean().optional(),
    productUpdates: z.boolean().optional(),
  })
  .strict();

export const preferencesSchema = z
  .object({
    currency: z.string().trim().length(3).optional(),
    dateFormat: z.enum(["DD MMM YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
    theme: z.enum(["dark", "light"]).optional(),
    compactSidebar: z.boolean().optional(),
    /** Owner-recorded life events (see lib/legacy-plan/life-events). */
    lifeEvents: lifeEventsSchema.optional(),
    /** Intelligence findings the owner reviewed and set aside (see lib/client/intelligence). */
    dismissedFindings: z
      .array(z.string().regex(/^[A-Z][A-Z0-9-]{2,23}:[a-z0-9,-]{1,400}$/))
      .max(200)
      .optional(),
  })
  .strict();

export const updatePreferencesSchema = z
  .object({
    preferences: preferencesSchema.optional(),
    notificationPreferences: notificationPreferencesSchema.optional(),
    securityPreferences: securityPreferencesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one preference group");

/** Days between a scheduled deletion request and the permanent deletion. */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

/** Deletion is confirmed explicitly, and acknowledged in the dialog (FR-B011). */
export const deleteAccountSchema = z.object({
  confirmed: z.literal(true, { error: "Confirm this deletion to continue." }),
});

/** What the owner types to delete permanently, now, with no grace period. */
export const DELETE_NOW_PHRASE = "DELETE PERMANENTLY";

export const deleteAccountNowSchema = z
  .object({
    confirmation: z.literal(DELETE_NOW_PHRASE, {
      error: `Type ${DELETE_NOW_PHRASE} to confirm.`,
    }),
  })
  .strict();

/** `GET /users/me/export?format=` — JSON stays the default for API callers. */
export const exportQuerySchema = z
  .object({ format: z.enum(["json", "xlsx", "csv"]).default("json") })
  .strict();

export type DeleteAccountBody = z.infer<typeof deleteAccountSchema>;
export type DeleteAccountNowBody = z.infer<typeof deleteAccountNowSchema>;
export type ExportQuery = z.infer<typeof exportQuerySchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesSchema>;
