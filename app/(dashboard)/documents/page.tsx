import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/shared/loading-skeleton";

import { DocumentsView } from "./_components/documents-view";

export const metadata: Metadata = { title: "Document Vault" };

export default function DocumentsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DocumentsView />
    </Suspense>
  );
}
