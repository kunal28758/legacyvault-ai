"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, Menu } from "lucide-react";

import { SystemStatusIndicator } from "@/components/layout/system-status-indicator";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { BrandLogo } from "@/components/shared/brand-logo";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const links = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#showcase", label: "Product" },
];

/** Signed-out call to action; also the pre-hydration state so nothing shifts. */
function SignedOutActions() {
  return (
    <>
      <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
        Sign in
      </Link>
      <Link href="/sign-up" className={buttonVariants()}>
        Create account
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </>
  );
}

/**
 * Session-aware navbar actions. `<SignedIn>` / `<SignedOut>` were removed in
 * Clerk Core 3 and `<Show>` is an async Server Component, so the client navbar
 * reads the session through `useAuth()` instead. Only mounted when Clerk is
 * configured — the hook requires `<ClerkProvider>`.
 */
function ClerkAccountActions() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded || !isSignedIn) return <SignedOutActions />;
  return (
    <Link href="/dashboard" className={buttonVariants()}>
      Open dashboard
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}

export function SiteNavbar({ clerkEnabled }: { clerkEnabled: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const accountActions = clerkEnabled ? <ClerkAccountActions /> : <SignedOutActions />;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-colors duration-300",
        scrolled
          ? "border-b border-glass-border bg-background/70 backdrop-blur-xl"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <BrandLogo />
        <nav aria-label="Site" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <SystemStatusIndicator className="mr-1" />
          <ThemeToggle />
          {accountActions}
        </div>
        <div className="flex items-center gap-1 md:hidden">
          <SystemStatusIndicator compact />
          <ThemeToggle />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
              <Menu />
            </SheetTrigger>
            <SheetContent side="right" className="w-[85vw] max-w-xs glass-strong">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </SheetHeader>
              <nav aria-label="Site" className="flex flex-col gap-1">
                {links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-base font-medium hover:bg-muted"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
              <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
                {accountActions}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
