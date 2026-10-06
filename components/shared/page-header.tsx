import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/** Page-level heading block: eyebrow, h1, description and right-aligned actions. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1 space-y-2">
          {eyebrow && (
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">
              <span aria-hidden className="h-px w-5 bg-gradient-to-r from-primary to-transparent" />
              {eyebrow}
            </div>
          )}
          <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight sm:text-[2rem]">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        )}
      </div>
      {children}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
  as: Tag = "h2",
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="space-y-1">
        <Tag className={cn("font-semibold tracking-tight", Tag === "h2" ? "text-lg" : "text-base")}>
          {title}
        </Tag>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
