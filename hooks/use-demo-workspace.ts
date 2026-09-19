"use client";

import { useEffect, useState } from "react";

import { useDemoStore } from "@/lib/demo/store";
import type { DemoWorkspace } from "@/lib/demo/types";

/**
 * Rehydrates the demo workspace from sessionStorage once on the client and
 * exposes it together with a `ready` flag. Pages render skeletons until `ready`
 * so server and client markup match (zustand persist runs with skipHydration).
 */
export function useDemoWorkspace(): { workspace: DemoWorkspace; ready: boolean } {
  const workspace = useDemoStore((s) => s.workspace);
  const hydrated = useDemoStore((s) => s.hydrated);

  useEffect(() => {
    if (useDemoStore.getState().hydrated) return;
    let cancelled = false;
    const finish = () => {
      if (!cancelled) useDemoStore.getState().setHydrated(true);
    };
    try {
      const result = useDemoStore.persist.rehydrate();
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).then(finish, finish);
      } else {
        finish();
      }
    } catch {
      finish();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return { workspace, ready: hydrated };
}

/** Current time that only ticks on the client (avoids hydration mismatches). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
