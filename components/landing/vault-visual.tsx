"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const VaultScene = dynamic(() => import("@/components/landing/vault-scene"), {
  ssr: false,
  loading: () => null,
});

/**
 * The vault shield as inline SVG: shown while the 3D scene loads, without
 * WebGL, or if the scene fails. It carries the same design — shield, keyhole,
 * dial and vault ring — so the hand-off to 3D is a refinement, not a swap.
 */
export function VaultFallback({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex items-center justify-center", className)} aria-hidden>
      <svg
        viewBox="0 0 400 400"
        className="h-[88%] w-[88%] drop-shadow-[0_0_40px_rgba(14,165,255,0.35)]"
      >
        <defs>
          <radialGradient id="lv-glow" cx="50%" cy="48%" r="50%">
            <stop offset="0%" stopColor="#0ea5ff" stopOpacity="0.4" />
            <stop offset="60%" stopColor="#2563eb" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lv-shield" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1b2d63" />
            <stop offset="55%" stopColor="#0b1633" />
            <stop offset="100%" stopColor="#0a1a3a" />
          </linearGradient>
          <linearGradient id="lv-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>
        <circle cx="200" cy="200" r="190" fill="url(#lv-glow)" />
        <circle cx="200" cy="200" r="168" fill="none" stroke="#1c2d5c" strokeWidth="10" />
        <circle
          cx="200"
          cy="200"
          r="180"
          fill="none"
          stroke="#22d3ee"
          strokeOpacity="0.5"
          strokeWidth="2"
          strokeDasharray="2 12"
        />
        <path
          d="M118 96 Q118 84 130 84 Q200 94 270 84 Q282 84 282 96 L282 170 C282 240 250 286 200 316 C150 286 118 240 118 170 Z"
          fill="url(#lv-shield)"
          stroke="url(#lv-edge)"
          strokeWidth="3"
        />
        <path
          d="M140 110 Q200 118 260 110 L260 170 C260 226 234 262 200 286 C166 262 140 226 140 170 Z"
          fill="#101d42"
          fillOpacity="0.7"
          stroke="#0ea5ff"
          strokeOpacity="0.35"
        />
        <circle cx="200" cy="186" r="38" fill="none" stroke="#0ea5ff" strokeWidth="4" />
        <circle
          cx="200"
          cy="186"
          r="48"
          fill="none"
          stroke="#6b5cff"
          strokeOpacity="0.7"
          strokeWidth="3"
          strokeDasharray="3 7"
        />
        <circle cx="200" cy="178" r="14" fill="#22d3ee" />
        <polygon points="194,186 206,186 211,212 189,212" fill="#22d3ee" />
      </svg>
    </div>
  );
}

class SceneBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Lazy, resilient wrapper around the procedural 3D vault shield: the three.js
 * bundle loads only on the client, after first paint, and only with WebGL.
 * The render loop pauses whenever the hero scrolls out of view, and a visitor
 * who prefers reduced motion gets one still frame.
 */
export function VaultVisual({
  className,
  sceneClassName,
}: {
  className?: string;
  sceneClassName?: string;
}) {
  const reduced = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(true);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 120));
    const handle = idle(() => setEnabled(supportsWebGL()));
    return () => {
      if (window.cancelIdleCallback && typeof handle === "number")
        window.cancelIdleCallback(handle);
    };
  }, []);

  useEffect(() => {
    const node = container.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      {
        rootMargin: "120px",
      },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className={cn("relative", className)}>
      <VaultFallback
        className={cn("absolute inset-0 transition-opacity duration-1000", enabled && "opacity-0")}
      />
      {enabled && (
        <SceneBoundary fallback={<VaultFallback className="absolute inset-0" />}>
          <div className={cn("absolute inset-0 animate-fade-in", sceneClassName)}>
            <VaultScene animate={!reduced} active={visible} />
          </div>
        </SceneBoundary>
      )}
    </div>
  );
}
