import type { Metadata } from "next";
import { Suspense } from "react";
import { currentUser } from "@clerk/nextjs/server";

import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { isClerkConfigured } from "@/lib/config/public-env";

import { SettingsView, type SettingsUser } from "./_components/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const clerkUser = await currentUser();
  const user: SettingsUser = {
    name: clerkUser?.fullName || clerkUser?.firstName || clerkUser?.username || "Account",
    email: clerkUser?.primaryEmailAddress?.emailAddress ?? null,
    imageUrl: clerkUser?.hasImage ? clerkUser.imageUrl : null,
  };
  return (
    <Suspense fallback={<PageSkeleton stats={0} />}>
      <SettingsView user={user} clerkEnabled={isClerkConfigured()} />
    </Suspense>
  );
}
