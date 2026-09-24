import { describe, expect, it } from "vitest";

import {
  asNotificationPreferences,
  shouldEmailNotification,
} from "@/lib/notifications/preferences";

/**
 * The switches in Settings are a promise (FR-L004, FR-B005).
 *
 * These assertions are the promise written down: what the person turned off
 * stays off, what they cannot turn off still arrives, and an unfamiliar
 * notification type is delivered rather than silently dropped.
 */
describe("notification email preferences", () => {
  it("sends by default", () => {
    expect(shouldEmailNotification("dms.reminder", {})).toEqual({ send: true });
    expect(shouldEmailNotification("ea.request", undefined)).toEqual({ send: true });
    expect(shouldEmailNotification("access.delivered", null)).toEqual({ send: true });
  });

  it("respects the master email switch", () => {
    expect(shouldEmailNotification("dms.reminder", { email: false })).toEqual({
      send: false,
      reason: "email_disabled",
    });
    expect(shouldEmailNotification("ea.request_created", { email: false })).toMatchObject({
      send: false,
    });
  });

  it("always sends a security alert, even with email switched off", () => {
    // The toggle for these is locked on in the product: being told that someone
    // signed in as you is not a preference.
    expect(shouldEmailNotification("security.new_device", { email: false })).toEqual({
      send: true,
    });
    expect(
      shouldEmailNotification("admin.role_changed", { email: false, securityAlerts: false }),
    ).toEqual({ send: true });
  });

  it("suppresses check-in reminders when they are turned off", () => {
    expect(shouldEmailNotification("dms.reminder", { checkInReminders: false })).toEqual({
      send: false,
      reason: "check_in_reminders_disabled",
    });
    // A release is not a reminder, and is not covered by that switch.
    expect(shouldEmailNotification("dms.released", { checkInReminders: true })).toEqual({
      send: true,
    });
  });

  it("treats product updates as opt-in", () => {
    expect(shouldEmailNotification("product.newsletter", {})).toMatchObject({ send: false });
    expect(shouldEmailNotification("product.newsletter", { productUpdates: true })).toEqual({
      send: true,
    });
  });

  it("reads the stored column defensively", () => {
    expect(asNotificationPreferences(null)).toEqual({
      email: undefined,
      securityAlerts: undefined,
      checkInReminders: undefined,
      productUpdates: undefined,
    });
    expect(asNotificationPreferences("not an object")).toEqual({
      email: undefined,
      securityAlerts: undefined,
      checkInReminders: undefined,
      productUpdates: undefined,
    });
    // A value of the wrong type is ignored rather than coerced into a decision.
    expect(asNotificationPreferences({ email: "no", checkInReminders: false })).toEqual({
      email: undefined,
      securityAlerts: undefined,
      checkInReminders: false,
      productUpdates: undefined,
    });
  });
});
