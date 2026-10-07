import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/loading-skeleton";

import { IntelligenceView } from "./_components/intelligence-view";

export const metadata: Metadata = { title: "Legacy Intelligence" };

export default function IntelligencePage() {
  return (
    <Suspense fallback={<PageSkeleton stats={5} />}>
      <IntelligenceView />
    </Suspense>
  );
}
