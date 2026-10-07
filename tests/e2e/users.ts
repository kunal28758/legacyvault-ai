/**
 * One Clerk development user per authenticated spec file.
 *
 * The application rate limiter is keyed by application user id and the
 * contracted `default` policy is 100 requests / 15 minutes (api-contracts.md).
 * A full suite of authenticated journeys exceeds that on a single account, so
 * the specs are separated rather than the limit being relaxed — the limiter is
 * a security control and the tests exist to run against the real one.
 *
 * The budget is per user, not per file, so a journey heavy enough to approach
 * it on its own gets an account of its own.
 *
 * `+clerk_test` addresses are Clerk's development test identifiers: the
 * email-code strategy accepts them without sending real mail.
 */
export const E2E_USERS = {
  beneficiaries: "e2e-beneficiaries+clerk_test@example.com",
  legacyPlan: "e2e-plan+clerk_test@example.com",
  assetAllocation: "e2e-allocation+clerk_test@example.com",
  access: "e2e-access+clerk_test@example.com",
  journey: "e2e-journey+clerk_test@example.com",
  settings: "e2e-settings+clerk_test@example.com",
  ai: "e2e-ai+clerk_test@example.com",
  commandCentre: "e2e-command+clerk_test@example.com",
  assetVault: "e2e-vault+clerk_test@example.com",
  assetGuard: "e2e-vault-guard+clerk_test@example.com",
  intelligence: "e2e-intel+clerk_test@example.com",
} as const;

export const E2E_USER_EMAILS = Object.values(E2E_USERS);
