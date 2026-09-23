"use client";

import { Mail, MoreHorizontal, Siren, TimerReset } from "lucide-react";

import { StatusBadge, toneForBeneficiaryStatus } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Beneficiary, BeneficiaryRoles } from "@/lib/types/beneficiary";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export type { BeneficiaryRoles };

export function RoleChips({ roles, className }: { roles: BeneficiaryRoles; className?: string }) {
  if (!roles.isTrustedContact && !roles.isEmergencyContact)
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {roles.isTrustedContact && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-purple/15 px-2 py-0.5 text-[11px] font-medium text-brand-purple" />
            }
          >
            <TimerReset className="size-3" aria-hidden /> Trusted contact
          </TooltipTrigger>
          <TooltipContent>
            Notified and granted release access by the Dead Man’s Switch
          </TooltipContent>
        </Tooltip>
      )}
      {roles.isEmergencyContact && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[11px] font-medium text-brand-cyan" />
            }
          >
            <Siren className="size-3" aria-hidden /> Emergency contact
          </TooltipTrigger>
          <TooltipContent>
            Can request emergency access with one-time-code verification
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

interface BeneficiaryCardProps {
  beneficiary: Beneficiary;
  roles: BeneficiaryRoles;
  onOpen: () => void;
  onMenu?: () => void;
}

/** Mobile / grid presentation of one beneficiary. */
export function BeneficiaryCard({ beneficiary, roles, onOpen, onMenu }: BeneficiaryCardProps) {
  const status = toneForBeneficiaryStatus(beneficiary.status);
  return (
    <Card className="motion-safe-transition glass-highlight glass hover:-translate-y-0.5">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <Avatar size="lg">
            <AvatarFallback className="bg-gradient-brand text-primary-foreground">
              {initials(beneficiary.name)}
            </AvatarFallback>
          </Avatar>
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="truncate font-medium">{beneficiary.name}</p>
            <p className="truncate text-xs text-muted-foreground">{beneficiary.relationship}</p>
          </button>
          {onMenu && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${beneficiary.name}`}
              onClick={onMenu}
            >
              <MoreHorizontal />
            </Button>
          )}
        </div>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <Mail className="size-3.5" aria-hidden /> {beneficiary.email}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <span className="text-xs text-muted-foreground">
            {roles.assignmentCount} assignment{roles.assignmentCount === 1 ? "" : "s"}
          </span>
        </div>
        <RoleChips roles={roles} />
      </CardContent>
    </Card>
  );
}
