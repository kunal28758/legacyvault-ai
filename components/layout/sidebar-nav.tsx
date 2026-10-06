"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ADMIN_NAV_GROUP, NAV_GROUPS, isActivePath } from "@/components/layout/nav-config";
import { useProfile } from "@/hooks/use-profile";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
  badges?: Record<string, number>;
}

/**
 * Grouped navigation list shared by the desktop sidebar and the mobile sheet.
 * The active item gets a tinted surface, a glowing indicator rail and a bright
 * icon; the surface glides between items (shared layout) unless motion is reduced.
 */
export function SidebarNav({ collapsed = false, onNavigate, badges = {} }: SidebarNavProps) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // The operator section appears only for an operator; the route and every
  // endpoint behind it check the role again on the server.
  const profile = useProfile();
  const groups =
    profile.data?.role === "SUPER_ADMIN" ? [...NAV_GROUPS, ADMIN_NAV_GROUP] : NAV_GROUPS;

  return (
    <nav aria-label="Primary" className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label ?? "root"} className="space-y-1">
          {group.label && !collapsed && (
            <p className="px-3 pb-1 text-[10.5px] font-semibold tracking-[0.16em] text-muted-foreground/70 uppercase">
              {group.label}
            </p>
          )}
          {group.label && collapsed && (
            <div className="mx-3 mb-2 h-px bg-sidebar-border" aria-hidden />
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActivePath(pathname, item.href);
              const badge = badges[item.href];
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-8 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150 outline-none",
                    "focus-visible:ring-3 focus-visible:ring-sidebar-ring/50",
                    active
                      ? "text-sidebar-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      aria-hidden
                      transition={
                        reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 38 }
                      }
                      className={cn(
                        "absolute inset-0 rounded-lg border",
                        item.ai
                          ? "border-brand-purple/25 bg-brand-purple/10"
                          : "border-primary/25 bg-primary/10 shadow-[0_0_24px_-10px_var(--brand-blue)]",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-2 bottom-2 -left-px w-[3px] rounded-full",
                          item.ai
                            ? "bg-brand-purple shadow-glow-purple"
                            : "bg-primary shadow-glow-blue",
                        )}
                      />
                    </motion.span>
                  )}
                  <item.icon
                    className={cn(
                      "relative size-[18px] shrink-0 transition-[color,transform] duration-200 group-hover:scale-105",
                      active
                        ? item.ai
                          ? "text-brand-purple"
                          : "text-primary"
                        : item.ai
                          ? "text-brand-purple/80"
                          : "text-muted-foreground group-hover:text-foreground",
                    )}
                    aria-hidden
                  />
                  {!collapsed && <span className="relative flex-1 truncate">{item.label}</span>}
                  {badge ? (
                    <span
                      className={cn(
                        "relative flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground",
                        collapsed && "absolute top-0.5 right-1 h-4 min-w-4 px-1 text-[10px]",
                      )}
                      aria-label={`${badge} unread`}
                    >
                      {badge > 9 ? "9+" : badge}
                    </span>
                  ) : null}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger render={link} />
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
