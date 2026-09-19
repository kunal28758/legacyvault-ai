"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

const VaultScene = dynamic(() => import("@/components/three/vault-scene"), {
  ssr: false,
  loading: () => null,
});

/** Pure-CSS stand-in used before the scene loads, without WebGL, or when it fails. */
export function VaultFallback({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex items-center justify-center", className)} aria-hidden>
      <div className="absolute size-[62%] [transform:rotateX(70deg)] rounded-full border border-brand-blue/40" />
      <div className="absolute size-[78%] [transform:rotateX(62deg)_rotateZ(35deg)] rounded-full border border-brand-purple/35" />
      <div className="absolute size-[92%] [transform:rotateX(75deg)_rotateZ(-25deg)] rounded-full border border-brand-cyan/30" />
      <div className="size-[34%] animate-float rounded-[30%] bg-gradient-brand opacity-90 shadow-glow-purple blur-[1px]" />
      <div className="absolute size-[40%] rounded-full bg-brand-cyan/10 blur-2xl" />
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
 * Lazy, resilient wrapper around the procedural 3D vault: loads only on the
 * client, falls back to CSS without WebGL or on error, and renders a single
 * still frame when the visitor prefers reduced motion.
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

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 120));
    const handle = idle(() => setEnabled(supportsWebGL()));
    return () => {
      if (window.cancelIdleCallback && typeof handle === "number")
        window.cancelIdleCallback(handle);
    };
  }, []);

  return (
    <div className={cn("relative", className)}>
      <VaultFallback
        className={cn("absolute inset-0 transition-opacity duration-700", enabled && "opacity-0")}
      />
      {enabled && (
        <SceneBoundary fallback={<VaultFallback className="absolute inset-0" />}>
          <div className={cn("absolute inset-0", sceneClassName)}>
            <VaultScene animate={!reduced} />
          </div>
        </SceneBoundary>
      )}
    </div>
  );
}
