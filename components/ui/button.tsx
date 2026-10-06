import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "cn";

/**
 * Button hierarchy (docs/ui/DESIGN_SYSTEM.md § 3):
 * - `default`     primary electric-blue CTA; the only variant with a resting glow
 * - `secondary`   elevated dark surface with a border
 * - `outline`     transparent with a border
 * - `ghost`       transparent, tinted on hover
 * - `success`     verified / confirm-safe actions (emerald)
 * - `destructive` irreversible or removing actions (red, tinted)
 * - `ai`          AI features only (violet tint)
 * - `link`        inline text action
 * Hover lifts the primary slightly; press scales to 0.98. Motion is transform-only
 * and is removed under `prefers-reduced-motion` by styles/animations.css.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform,filter] duration-200 ease-out outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/45 focus-visible:ring-offset-0 active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-cta hover:-translate-y-px hover:shadow-glow-blue hover:brightness-110 focus-visible:ring-primary/50",
        secondary:
          "border-border bg-secondary text-secondary-foreground shadow-glass hover:border-primary/35 hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary",
        outline:
          "border-input bg-transparent hover:border-primary/40 hover:bg-primary/8 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        ghost:
          "text-foreground/85 hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/70",
        success:
          "bg-success text-primary-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/0.25)] hover:-translate-y-px hover:shadow-glow-success hover:brightness-110 focus-visible:ring-success/45 light:text-white",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive hover:border-destructive/45 hover:bg-destructive/18 focus-visible:border-destructive/40 focus-visible:ring-destructive/25 dark:bg-destructive/15 dark:hover:bg-destructive/25",
        ai: "border-brand-purple/30 bg-brand-purple/12 text-[color-mix(in_oklch,var(--brand-purple),var(--foreground)_25%)] hover:border-brand-purple/55 hover:bg-brand-purple/20 hover:shadow-glow-purple focus-visible:ring-brand-purple/40",
        link: "h-auto! px-0! text-primary underline-offset-4 hover:underline active:scale-100!",
      },
      size: {
        default:
          "h-9 gap-2 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-[min(var(--radius-md),12px)] px-3 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 rounded-xl px-5 text-[0.95rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9",
        "icon-xs":
          "size-7 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm":
          "size-8 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-11 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner, marks the button busy and blocks repeat activation. */
    loading?: boolean;
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />}
      {children}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
