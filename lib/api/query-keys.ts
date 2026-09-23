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
} as const;
