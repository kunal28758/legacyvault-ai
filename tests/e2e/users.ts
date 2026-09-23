/**
 * One Clerk development user per authenticated spec file.
 *
 * The application rate limiter is keyed by application user id and the
 * contracted `default` policy is 100 requests / 15 minutes (api-contracts.md).
 * A full suite of authenticated journeys exceeds that on a single account, so
 * the specs are separated rather than the limit being relaxed — the limiter is
 * a security control and the tests exist to run against the real one.
 *
 * `+clerk_test` addresses are Clerk's development test identifiers: the
 * email-code strategy accepts them without sending real mail.
 */
export const E2E_USERS = {
  beneficiaries: "e2e-beneficiaries+clerk_test@example.com",
  legacyPlan: "e2e-plan+clerk_test@example.com",
} as const;

export const E2E_USER_EMAILS = Object.values(E2E_USERS);
