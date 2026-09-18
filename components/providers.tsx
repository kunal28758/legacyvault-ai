"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError, ReverificationRequiredError } from "@/lib/api/client";
import { makeQueryClient } from "@/lib/api/query-client";

/**
 * Client-side providers (tasks T014/T017): TanStack Query, theme attribute handling
 * (`data-theme`, dark-first per constitution XIII / UX-002), tooltips and toasts.
 * `<ClerkProvider>` wraps this from app/layout.tsx (server side).
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() =>
    makeQueryClient((error) => {
      // Reverification is handled by the re-auth gate (T201), not by a toast.
      if (error instanceof ReverificationRequiredError) return;
      if (error instanceof ApiError && error.isRateLimited) {
        const wait = error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds}s.` : "";
        toast.error(`Too many requests.${wait}`);
        return;
      }
      if (error instanceof ApiError && error.isUnauthenticated) return; // Clerk redirects
      if (error instanceof ApiError && !error.isValidationError) {
        toast.error(error.message);
      }
    }),
  );

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      themes={["dark", "light"]}
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={200}>{children}</TooltipProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
