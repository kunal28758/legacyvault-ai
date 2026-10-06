import type { Metadata } from "next";

import { LifeEventsView } from "./_components/life-events-view";

export const metadata: Metadata = { title: "Life Events" };

export default function LifeEventsPage() {
  return <LifeEventsView />;
}
