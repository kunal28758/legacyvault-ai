import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";

import { isClerkConfigured } from "@/lib/config/public-env";

import { AuthNotConfigured } from "../../_components/auth-not-configured";
import { clerkAuthAppearance } from "../../_components/clerk-appearance";

export const metadata: Metadata = { title: "Create account" };

/** Clerk `<SignUp/>` themed to the design system (task T041); Clerk runs email verification. */
export default function SignUpPage() {
  if (!isClerkConfigured()) return <AuthNotConfigured mode="sign-up" />;
  return (
    <SignUp appearance={clerkAuthAppearance} signInUrl="/sign-in" forceRedirectUrl="/dashboard" />
  );
}
