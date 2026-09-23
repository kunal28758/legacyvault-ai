"use client";

import { useCallback, useMemo } from "react";
import { useUser } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * The account's active sessions, from Clerk.
 *
 * Sessions belong to Clerk, not to this database (ADR-003), so they are read
 * and revoked through Clerk's own client rather than mirrored into a table.
 * Revoking ends that device's session immediately; the Clerk webhook mirrors
 * the event into the audit log.
 */
export function useClerkSessions() {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["clerk-sessions", user?.id ?? "none"] as const, [user?.id]);

  const query = useQuery({
    queryKey,
    enabled: isLoaded && Boolean(user),
    queryFn: async () => (user ? user.getSessions() : []),
    // Device lists go stale quickly and are cheap to refetch.
    staleTime: 30_000,
  });

  const revoke = useCallback(
    async (sessionId: string) => {
      const session = (query.data ?? []).find((entry) => entry.id === sessionId);
      if (!session) return;
      await session.revoke();
      await queryClient.invalidateQueries({ queryKey });
    },
    [query.data, queryClient, queryKey],
  );

  return {
    sessions: query.data ?? [],
    loading: !isLoaded || query.isPending,
    revoke,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  };
}
