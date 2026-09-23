import type { Metadata } from "next";

import { EmergencyRequestForm } from "../_components/emergency-request-form";

export const metadata: Metadata = {
  title: "Request emergency access",
  robots: { index: false, follow: false },
};

/**
 * Where a designated contact asks (FR-J002).
 *
 * The page renders the same for any id: a configuration that does not exist
 * must look exactly like one that does, or this page becomes a way to find out
 * who someone's emergency contacts are.
 */
export default async function EmergencyRequestPage({
  params,
}: {
  params: Promise<{ configId: string }>;
}) {
  const { configId } = await params;
  return <EmergencyRequestForm configId={configId} />;
}
