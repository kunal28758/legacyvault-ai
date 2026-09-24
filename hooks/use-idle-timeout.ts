"use client";

import { useEffect, useRef } from "react";
import { useClerk } from "@clerk/nextjs";
import { toast } from "sonner";

import { useProfile } from "@/hooks/use-profile";

/**
 * Application-enforced idle sign-out (FR-A008).
 *
 * Clerk expires a session server-side, but the contract also lets a person
 * choose a shorter window for the browser in front of them — a vault left open
 * on a shared laptop is the case this exists for. The choice lives in
 * `securityPreferences.idleTimeoutMinutes`; `null` means "do not".
 *
 * Signing out is a client action on the Clerk session, so the timer is here.
 * It is not a security boundary on its own: the server still decides what any
 * request is allowed to do.
 */
const WARNING_MS = 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "visibilitychange"];

export function useIdleTimeout(): void {
  const { signOut } = useClerk();
  const profile = useProfile();
  const minutes = readMinutes(profile.data?.securityPreferences);

  // Kept in a ref so restarting the countdown never re-runs the effect.
  const timers = useRef<{ warn?: number; out?: number }>({});

  useEffect(() => {
    if (!minutes) return;
    const timeoutMs = minutes * 60_000;

    const clear = () => {
      if (timers.current.warn) window.clearTimeout(timers.current.warn);
      if (timers.current.out) window.clearTimeout(timers.current.out);
    };

    const start = () => {
      clear();
      if (timeoutMs > WARNING_MS) {
        timers.current.warn = window.setTimeout(() => {
          toast.warning("You will be signed out shortly", {
            description: "Move the mouse or press a key to stay signed in.",
            duration: WARNING_MS,
          });
        }, timeoutMs - WARNING_MS);
      }
      timers.current.out = window.setTimeout(() => {
        void signOut({ redirectUrl: "/sign-in" });
      }, timeoutMs);
    };

    const onActivity = () => {
      // A tab going to the background is not activity; coming back is.
      if (document.visibilityState === "hidden") return;
      start();
    };

    start();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    return () => {
      clear();
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
    };
  }, [minutes, signOut]);
}

function readMinutes(preferences: Record<string, unknown> | undefined): number | null {
  const value = preferences?.idleTimeoutMinutes;
  return typeof value === "number" && value > 0 ? value : null;
}
