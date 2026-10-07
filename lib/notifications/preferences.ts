import "server-only";

/**
 * Whether a notification may be emailed (FR-L004, FR-B005).
 *
 * The switches in Settings are a promise, so they are evaluated here — once,
 * in one place, by a pure function the delivery job calls and the tests pin
 * down. Two rules are worth stating plainly:
 *
 *  • **Security alerts always send.** The toggle for them is locked on in the
 *    product, because being told that someone signed in as you is not a
 *    preference. They ignore the master email switch for the same reason.
 *    So do the emergency-release warnings (grace period, escalation, release)
 *    and emergency-access alerts: they are the owner's last chance to stop a
 *    release, so "check-in reminders" governs only the routine reminder.
 *  • **Anything unrecognised sends.** A new notification type is far more
 *    likely to be consequential (an access link, an emergency request) than
 *    promotional, and silently dropping it would be the worse failure.
 */
export interface NotificationPreferences {
  email?: boolean;
  securityAlerts?: boolean;
  checkInReminders?: boolean;
  productUpdates?: boolean;
}

export type EmailDecision = { send: true } | { send: false; reason: string };

/**
 * Every release stage after the routine reminder, and an emergency request that
 * a timeout rule could grant: the owner may be about to lose control.
 */
export const ALWAYS_SENT = new Set([
  "dms.grace_period",
  "dms.escalating",
  "dms.released",
  "dms.release_held",
  "ea.request_pending",
  "ea.access_granted",
]);

export function shouldEmailNotification(
  type: string,
  preferences: NotificationPreferences | null | undefined,
): EmailDecision {
  const prefs = preferences ?? {};

  if (type.startsWith("security.") || type.startsWith("admin.") || ALWAYS_SENT.has(type)) {
    return { send: true };
  }

  if (prefs.email === false) return { send: false, reason: "email_disabled" };

  if (type.startsWith("dms.") && prefs.checkInReminders === false) {
    return { send: false, reason: "check_in_reminders_disabled" };
  }
  if (type.startsWith("product.") && prefs.productUpdates !== true) {
    return { send: false, reason: "product_updates_disabled" };
  }
  return { send: true };
}

/** Reads the JSON column into the shape above, ignoring anything unexpected. */
export function asNotificationPreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const pick = (key: string): boolean | undefined =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : undefined;
  return {
    email: pick("email"),
    securityAlerts: pick("securityAlerts"),
    checkInReminders: pick("checkInReminders"),
    productUpdates: pick("productUpdates"),
  };
}
