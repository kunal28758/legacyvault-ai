import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { AuthLayout } from "@/components/layout/auth-layout";
import { isClerkConfigured } from "@/lib/config/public-env";

/** Auth route group (task T047): signed-in visitors go straight to the dashboard. */
export default async function AuthGroupLayout({ children }: { children: ReactNode }) {
  await connection();
  if (isClerkConfigured()) {
    const { userId } = await auth();
    if (userId) redirect("/dashboard");
  }
  return <AuthLayout>{children}</AuthLayout>;
}
