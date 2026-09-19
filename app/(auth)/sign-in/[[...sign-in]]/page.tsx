import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";

import { isClerkConfigured } from "@/lib/config/public-env";

import { AuthNotConfigured } from "../../_components/auth-not-configured";
import { clerkAuthAppearance } from "../../_components/clerk-appearance";

export const metadata: Metadata = { title: "Sign in" };

/** Clerk `<SignIn/>` themed to the design system (task T040). */
export default function SignInPage() {
  if (!isClerkConfigured()) return <AuthNotConfigured mode="sign-in" />;
  return (
    <SignIn appearance={clerkAuthAppearance} signUpUrl="/sign-up" forceRedirectUrl="/dashboard" />
  );
}
