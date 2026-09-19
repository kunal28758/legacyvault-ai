"use client";

import { useReducedMotion as useFramerReducedMotion } from "framer-motion";

/**
 * Single source of truth for `prefers-reduced-motion` (task T168, constitution
 * XIV / UX-009). Framer Motion components read it through this hook; GSAP and
 * three.js visuals must check it before starting any loop.
 */
export function useReducedMotion(): boolean {
  return useFramerReducedMotion() ?? false;
}

/** Framer Motion variants that collapse to opacity-only when motion is reduced. */
export function fadeUp(reduced: boolean, distance = 12) {
  return {
    hidden: { opacity: 0, y: reduced ? 0 : distance },
    visible: { opacity: 1, y: 0 },
  };
}

export const staggerContainer = (stagger = 0.06, delay = 0) => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

export const easeOut = [0.22, 1, 0.36, 1] as const;
