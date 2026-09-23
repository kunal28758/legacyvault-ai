import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";

import { DashboardView } from "./_components/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

/** Dashboard (task T051). Every figure comes from the versioned API. */
export default async function DashboardPage() {
  const user = await currentUser();
  const firstName = user?.firstName || user?.fullName?.split(" ")[0] || null;
  return <DashboardView firstName={firstName} />;
}
