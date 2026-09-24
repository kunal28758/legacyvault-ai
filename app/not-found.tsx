import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The 404 for every route group.
 *
 * Deliberately says nothing about what does exist: `/admin` and a beneficiary's
 * `/access` link both answer through this page for someone who should not have
 * them, and a helpful "did you mean" would undo that.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-1 flex-col items-center justify-center gap-5 bg-gradient-surface px-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-purple/15 text-brand-purple">
        <Compass className="size-7" aria-hidden />
      </span>
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">This page does not exist</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The link may be out of date, or it may never have been yours to open. Nothing was changed.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button render={<Link href="/dashboard" />}>Go to my dashboard</Button>
        <Button variant="outline" render={<Link href="/" />}>
          Back to the home page
        </Button>
      </div>
    </div>
  );
}
