import type { Metadata } from "next";

import { DeadManSwitchView } from "./_components/dead-man-switch-view";

export const metadata: Metadata = { title: "Dead Man's Switch" };

export default function DeadManSwitchPage() {
  return <DeadManSwitchView />;
}
