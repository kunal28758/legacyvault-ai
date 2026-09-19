import type { Metadata } from "next";

import { WizardView } from "./_components/wizard-view";

export const metadata: Metadata = { title: "Create Will" };

/** Eleven-step legacy plan wizard (tasks T064–T069, T221–T224 — UI; API wiring pending T058/T059). */
export default function LegacyPlanWizardPage() {
  return <WizardView />;
}
