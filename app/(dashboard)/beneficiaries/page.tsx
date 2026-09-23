import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/loading-skeleton";

import { BeneficiariesView } from "./_components/beneficiaries-view";

export const metadata: Metadata = { title: "Beneficiaries" };

/** Beneficiary management (tasks T071-T076) — persisted through /api/v1/beneficiaries. */
export default function BeneficiariesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BeneficiariesView />
    </Suspense>
  );
}
