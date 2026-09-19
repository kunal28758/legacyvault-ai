import type { Metadata } from "next";

import { LegacyPlanView } from "./_components/legacy-plan-view";

export const metadata: Metadata = { title: "Legacy Plan" };

/** Legacy plan hub (task T064 / T070 — UI; API wiring pending T058/T059). */
export default function LegacyPlanPage() {
  return <LegacyPlanView />;
}
