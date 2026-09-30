"use client";

import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Counts up to a real number once it arrives. Purely presentational: the
 * final value is always the exact one passed in (and is what assistive
 * technology reads); visitors who prefer reduced motion see it immediately.
 */
export function CountUp({ value, durationMs = 900 }: { value: number; durationMs?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(origin + (value - origin) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduced]);

  return (
    <>
      <span aria-hidden>{(reduced ? value : shown).toLocaleString("en-IN")}</span>
      <span className="sr-only">{value.toLocaleString("en-IN")}</span>
    </>
  );
}
