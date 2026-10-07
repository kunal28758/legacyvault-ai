/**
 * Central TanStack Query key factory.
 *
 * One place so invalidation after a mutation cannot drift from the key a query
 * actually used. Keys are hierarchical: invalidating `beneficiaries.all`
 * invalidates every list and detail beneath it.
 */
export const queryKeys = {
  users: {
    me: () => ["users", "me"] as const,
  },
  beneficiaries: {
    all: () => ["beneficiaries"] as const,
    lists: () => ["beneficiaries", "list"] as const,
    list: (filters: Record<string, unknown>) => ["beneficiaries", "list", filters] as const,
    details: () => ["beneficiaries", "detail"] as const,
    detail: (id: string) => ["beneficiaries", "detail", id] as const,
  },
  assets: {
    all: () => ["assets"] as const,
    ofKind: (kind: string) => ["assets", kind] as const,
    list: (kind: string, filters: Record<string, unknown>) =>
      ["assets", kind, "list", filters] as const,
    detail: (kind: string, id: string) => ["assets", kind, "detail", id] as const,
    assignments: (kind: string, id: string) => ["assets", kind, "assignments", id] as const,
  },
  documents: {
    all: () => ["documents"] as const,
    list: (filters: Record<string, unknown>) => ["documents", "list", filters] as const,
    detail: (id: string) => ["documents", "detail", id] as const,
    folders: () => ["documents", "folders"] as const,
  },
  videos: {
    all: () => ["videos"] as const,
    list: (filters: Record<string, unknown>) => ["videos", "list", filters] as const,
    detail: (id: string) => ["videos", "detail", id] as const,
  },
  notifications: {
    all: () => ["notifications"] as const,
    list: (filters: Record<string, unknown>) => ["notifications", "list", filters] as const,
    unreadCount: () => ["notifications", "unread-count"] as const,
  },
  deadManSwitch: {
    all: () => ["dead-man-switch"] as const,
    detail: () => ["dead-man-switch", "detail"] as const,
  },
  emergencyAccess: {
    all: () => ["emergency-access"] as const,
    contacts: () => ["emergency-access", "contacts"] as const,
    requests: () => ["emergency-access", "requests"] as const,
  },
  accessTokens: {
    all: () => ["access-tokens"] as const,
    forBeneficiary: (id: string) => ["access-tokens", id] as const,
    live: () => ["access-tokens", "live"] as const,
  },
  legacyPlan: {
    all: () => ["legacy-plan"] as const,
    overview: () => ["legacy-plan", "overview"] as const,
    current: () => ["legacy-plan", "current"] as const,
    detail: (id: string) => ["legacy-plan", "detail", id] as const,
    review: (id: string) => ["legacy-plan", "review", id] as const,
    versions: (id: string) => ["legacy-plan", "versions", id] as const,
    version: (id: string, versionId: string) => ["legacy-plan", "versions", id, versionId] as const,
  },
  system: {
    status: () => ["system", "status"] as const,
  },
  ai: {
    all: () => ["ai"] as const,
    availability: () => ["ai", "availability"] as const,
    interactions: () => ["ai", "interactions"] as const,
    analyses: (documentId: string) => ["ai", "analyses", documentId] as const,
  },
} as const;
