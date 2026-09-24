import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getOptionalUser } from "@/lib/auth/require-user";

import { OnboardingForm } from "./_components/onboarding-form";

export const metadata: Metadata = { title: "Welcome" };

/**
 * First run (FR-B001–B004).
 *
 * Deliberately outside the dashboard shell: there is nothing to navigate to
 * yet, and the one thing worth doing is the three fields the rest of the
 * product reads. Everything asked here can also be changed later in Settings,
 * and the step can be finished with the fields left empty.
 */
export default async function OnboardingPage() {
  await connection();

  const user = await getOptionalUser();
  if (!user) redirect("/sign-in");
  if (user.onboardingCompletedAt) redirect("/dashboard");

  return <OnboardingForm name={user.name} />;
}
