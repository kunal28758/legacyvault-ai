import type { Metadata } from "next";

import { LegacyPlanView } from "./_components/legacy-plan-view";

export const metadata: Metadata = { title: "Legacy Plan" };

/** Legacy plan hub (tasks T064/T070), backed by `/api/v1/legacy-plans`. */
export default function LegacyPlanPage() {
  return <LegacyPlanView />;
}
