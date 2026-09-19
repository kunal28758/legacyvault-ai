"use client";

import { useState } from "react";
import { FlaskConical, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDemoStore } from "@/lib/demo/store";
import { cn } from "@/lib/utils";

/**
 * Makes the demo boundary explicit: the workspace shown in the application shell
 * is synthetic and lives only in this browser tab. Offers a reset.
 */
export function DemoWorkspaceBadge({ className }: { className?: string }) {
  const reset = useDemoStore((s) => s.resetWorkspace);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={cn("flex items-center gap-1", className)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 text-xs font-medium text-warning" />
            }
          >
            <FlaskConical className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Demo workspace</span>
            <span className="sm:hidden">Demo</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64 text-center">
            Sample data stored only in this browser tab. Nothing here is uploaded or persisted to
            your account.
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reset demo workspace"
                onClick={() => setOpen(true)}
              />
            }
          >
            <RotateCcw />
          </TooltipTrigger>
          <TooltipContent side="bottom">Reset demo workspace</TooltipContent>
        </Tooltip>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reset the demo workspace?"
        description="Every change you made in this tab (beneficiaries, assets, plan progress, switch state) goes back to the sample data."
        confirmLabel="Reset"
        variant="destructive"
        onConfirm={() => {
          reset();
          toast.success("Demo workspace reset");
        }}
      />
    </>
  );
}
