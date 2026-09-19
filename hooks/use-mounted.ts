"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True after hydration, false during SSR / the first client render (no effect-driven setState). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
