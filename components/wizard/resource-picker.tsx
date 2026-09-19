"use client";

import Link from "next/link";
import { Plus, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface PickerItem {
  id: string;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  icon?: LucideIcon;
}

interface ResourcePickerProps {
  items: PickerItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  none?: boolean;
  onNoneChange?: (value: boolean) => void;
  noneLabel?: string;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  addHref: string;
  addLabel: string;
  error?: string;
  disabled?: boolean;
}

/**
 * Selection list used by wizard steps 3–6 and 9. Steps store references to the
 * module records (beneficiary/asset/document ids) rather than copies.
 */
export function ResourcePicker({
  items,
  selected,
  onChange,
  none,
  onNoneChange,
  noneLabel = "I have none of these",
  emptyIcon,
  emptyTitle,
  emptyDescription,
  addHref,
  addLabel,
  error,
  disabled,
}: ResourcePickerProps) {
  const toggle = (id: string, checked: boolean) => {
    onChange(checked ? [...selected, id] : selected.filter((s) => s !== id));
  };
  const allSelected = items.length > 0 && items.every((i) => selected.includes(i.id));

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button variant="outline" nativeButton={false} render={<Link href={addHref} />}>
              <Plus data-icon="inline-start" />
              {addLabel}
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {selected.length} of {items.length} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || none}
                onClick={() => onChange(allSelected ? [] : items.map((i) => i.id))}
              >
                {allSelected ? "Clear all" : "Select all"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={addHref} />}
              >
                <Plus data-icon="inline-start" />
                {addLabel}
              </Button>
            </div>
          </div>
          <ul
            className={cn("grid gap-2 sm:grid-cols-2", none && "opacity-50")}
            aria-describedby={error ? "resource-picker-error" : undefined}
          >
            {items.map((item) => {
              const checked = selected.includes(item.id);
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <Label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal transition-colors",
                      checked
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-muted/40",
                      (disabled || none) && "pointer-events-none",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled || none}
                      onCheckedChange={(value) => toggle(item.id, Boolean(value))}
                      className="mt-0.5"
                    />
                    {Icon && (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <Icon className="size-4" aria-hidden />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      {item.subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {item.meta && (
                      <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>
                    )}
                  </Label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {onNoneChange && (
        <Label className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3 font-normal">
          <span className="text-sm">{noneLabel}</span>
          <Switch
            checked={Boolean(none)}
            disabled={disabled}
            onCheckedChange={(value) => onNoneChange(Boolean(value))}
          />
        </Label>
      )}
      {error && (
        <p id="resource-picker-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
