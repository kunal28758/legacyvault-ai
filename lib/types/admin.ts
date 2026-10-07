import type { Database } from "@/lib/types/database";
import type { ActivityEntry } from "@/lib/types/activity";

/**
 * The operator's view of the platform (FR-P001–P012).
 *
 * Everything here is deliberately coarse: counts, states and timestamps. A
 * Super Admin runs the platform, which does not mean reading anybody's vault —
 * no plan content, no asset values, no document names, no encrypted field and
 * no access-link plaintext appears in any of these shapes.
 */
export type UserRole = Database["public"]["Enums"]["user_role"];

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: boolean;
  mfaEnabled: boolean;
  onboardingCompletedAt: string | null;
  lastLoginAt: string | null;
  deletionRequestedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface AdminUserListResult {
  items: AdminUserSummary[];
  total: number;
  page: number;
  limit: number;
}

/** Counts only — enough to investigate a support question, never the contents. */
export interface AdminUserDetail extends AdminUserSummary {
  clerkUserId: string;
  counts: {
    beneficiaries: number;
    assets: number;
    documents: number;
    videos: number;
    legacyPlans: number;
    accessTokensLive: number;
  };
  deadManSwitch: { status: string; nextCheckInAt: string | null } | null;
  recentActivity: ActivityEntry[];
}

export interface AdminAnalytics {
  users: { total: number; active: number; pendingDeletion: number; superAdmins: number };
  /** New accounts per day, most recent last. */
  registrations: { day: string; count: number }[];
  storage: {
    documents: { count: number; bytes: number };
    videos: { count: number; bytes: number };
  };
  protection: {
    switchesActive: number;
    switchesReleased: number;
    /** At the release point but held: no warning to the owner confirmed delivered. */
    switchesHeld: number;
    emergencyPending: number;
  };
  jobs: { queued: number; running: number; dead: number; succeededLastDay: number };
}

export interface AdminDeadJob {
  id: string;
  type: string;
  attempts: number;
  lastError: string | null;
  runAt: string;
  finishedAt: string | null;
  /** For `access.deliver` failures, the token the operator can resend. */
  accessTokenId: string | null;
  beneficiaryId: string | null;
}

export interface AdminOperations {
  deadJobs: AdminDeadJob[];
  undeliveredTokens: {
    id: string;
    grantType: string;
    beneficiaryId: string;
    ownerUserId: string;
    createdAt: string;
    expiresAt: string;
  }[];
}
