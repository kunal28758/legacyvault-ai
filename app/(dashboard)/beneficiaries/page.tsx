import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/loading-skeleton";

import { BeneficiariesView } from "./_components/beneficiaries-view";

export const metadata: Metadata = { title: "Beneficiaries" };

/** Beneficiary management (tasks T075/T076/T099 — UI; API wiring pending T072/T073). */
export default function BeneficiariesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BeneficiariesView />
    </Suspense>
  );
}
