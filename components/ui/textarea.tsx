import * as React from "react";
import { cn } from "cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-surface/70 px-3 py-2 text-base shadow-[inset_0_1px_2px_oklch(0_0_0/0.12)] transition-[color,background-color,border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/75 hover:border-[color-mix(in_oklch,var(--brand-blue)_25%,var(--input))] focus-visible:border-primary/70 focus-visible:ring-3 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
