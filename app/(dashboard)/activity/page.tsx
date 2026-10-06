import type { Metadata } from "next";

import { ActivityView } from "./_components/activity-view";

export const metadata: Metadata = { title: "Activity Log" };

export default function ActivityPage() {
  return <ActivityView />;
}
