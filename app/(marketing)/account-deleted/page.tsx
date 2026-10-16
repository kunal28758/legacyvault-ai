import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, Clock } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Account deleted" };

/**
 * Where an immediate deletion lands (and where a session that outlived its
 * account is sent by the dashboard layout). `status` only chooses the wording:
 * it comes from the deletion response, and the page reveals nothing either way.
 */
export default async function AccountDeletedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const pending = status === "pending";
  const Icon = pending ? Clock : CircleCheck;

  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-20">
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-xl border",
          pending
            ? "border-warning/30 bg-warning/10 text-warning"
            : "border-success/30 bg-success/10 text-success",
        )}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">
          {pending ? "Your account is closed" : "This account has been deleted"}
        </h1>
        <p className="leading-7 text-muted-foreground">
          {pending
            ? "Access to the account and everything in it was disabled immediately, and its sessions were signed out. Permanent removal of its files, records and sign-in identity has started and is being retried automatically until it completes."
            : "Its vault, documents, videos, beneficiaries, plans and sign-in identity are no longer available."}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          The security audit log is kept for accountability and can include details that were
          entered in the account, such as beneficiary or asset names.
        </p>
      </div>
      <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>
        Back to the home page
      </Link>
    </section>
  );
}
