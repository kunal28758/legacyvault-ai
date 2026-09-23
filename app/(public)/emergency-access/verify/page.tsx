import type { Metadata } from "next";
import { Suspense } from "react";

import { EmergencyVerifyForm } from "../_components/emergency-verify-form";

export const metadata: Metadata = {
  title: "Verify your request",
  robots: { index: false, follow: false },
};

/** Where the emailed code is entered, and where the decision is waited for. */
export default function EmergencyVerifyPage() {
  return (
    <Suspense fallback={null}>
      <EmergencyVerifyForm />
    </Suspense>
  );
}
