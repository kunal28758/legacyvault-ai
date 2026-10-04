import "server-only";

/**
 * What an operator may read from somebody else's audit rows (FR-P005, FR-P012).
 *
 * The Class A audit triggers deliberately record *what changed*, values
 * included, so the owner can see their own history in full. That makes the raw
 * trail vault content: a beneficiary's name and email, an asset's name, a note.
 * An operator investigating a support case needs the shape of the event — what
 * happened, to what, when, and whether it was refused — and never the values.
 *
 * The filter is an allow-list on purpose. A deny-list leaks the first time a
 * new domain writes a new key, and this file would not be touched.
 */
const STRUCTURAL_KEYS = new Set([
  // What kind of change, from the triggers and the guarded functions.
  "source",
  "changed",
  "db_role",
  "reason",
  "status",
  "previousStatus",
  "from",
  "to",
  "step",
  "eventType",
  "grantType",
  "outcome",
  "disposition",
  // Counts and flags — never the things being counted.
  "count",
  "contacts",
  "steps",
  "attempts",
  "returned",
  "days",
  "scopeCounts",
  "sharesRemoved",
  "attachmentsRemoved",
  "assignmentsRemoved",
  "releaseTokensRevoked",
  "accessTokensRevoked",
  "decryptedFields",
  "gracePeriodDays",
  "recognised",
  "scan",
  "performed",
  "emailSent",
  "alreadyRevoked",
  "queued",
  // Identifiers: opaque, and the whole point of an investigation.
  "ownerUserId",
  "beneficiaryId",
  "configId",
  "requestId",
  "switchId",
  "releaseEventId",
  "tokenId",
  "replacesTokenId",
  "jobId",
  "versionId",
  "versionNumber",
  "lockVersion",
  "resourceType",
  "resourceId",
  "notificationId",
  "providerMessageId",
  "subjectEmail",
  "field",
  "fields",
  "level",
  "policy",
]);

/** Keeps structural keys, drops everything else, and says so when it did. */
export function redactAdminMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};

  const source = metadata as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  let dropped = 0;

  for (const [key, value] of Object.entries(source)) {
    if (!STRUCTURAL_KEYS.has(key)) {
      dropped += 1;
      continue;
    }
    // An allowed key can still hold a nested object of values (`new`, `previous`
    // are not allowed, but be strict anyway): keep scalars and string arrays.
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      safe[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      safe[key] = value;
    } else if (key === "scopeCounts" && typeof value === "object") {
      safe[key] = value;
    } else {
      dropped += 1;
    }
  }

  if (dropped > 0) safe.redactedKeys = dropped;
  return safe;
}
