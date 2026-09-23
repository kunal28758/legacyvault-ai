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
  legacyPlan: {
    all: () => ["legacy-plan"] as const,
    overview: () => ["legacy-plan", "overview"] as const,
    current: () => ["legacy-plan", "current"] as const,
    detail: (id: string) => ["legacy-plan", "detail", id] as const,
    review: (id: string) => ["legacy-plan", "review", id] as const,
    versions: (id: string) => ["legacy-plan", "versions", id] as const,
    version: (id: string, versionId: string) => ["legacy-plan", "versions", id, versionId] as const,
  },
} as const;
