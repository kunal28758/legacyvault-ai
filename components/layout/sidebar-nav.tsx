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

/** Grouped navigation list shared by the desktop sidebar and the mobile sheet. */
export function SidebarNav({ collapsed = false, onNavigate, badges = {} }: SidebarNavProps) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  // The operator section appears only for an operator; the route and every
  // endpoint behind it check the role again on the server.
  const profile = useProfile();
  const groups =
    profile.data?.role === "SUPER_ADMIN" ? [...NAV_GROUPS, ADMIN_NAV_GROUP] : NAV_GROUPS;

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label ?? "root"} className="space-y-1">
          {group.label && !collapsed && (
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/80 uppercase">
              {group.label}
            </p>
          )}
          {group.label && collapsed && (
            <div className="mx-3 my-1 h-px bg-sidebar-border" aria-hidden />
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
                    "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active
                      ? "text-sidebar-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      aria-hidden
                      transition={
                        reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }
                      }
                      className="absolute inset-0 rounded-lg border border-glass-border bg-sidebar-accent shadow-glow-blue/40"
                    />
                  )}
                  <span
                    className={cn(
                      "relative flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                      active
                        ? "bg-gradient-brand text-primary-foreground"
                        : "bg-transparent group-hover:bg-background/40",
                    )}
                  >
                    <item.icon className="size-4" aria-hidden />
                  </span>
                  {!collapsed && <span className="relative flex-1 truncate">{item.label}</span>}
                  {badge ? (
                    <span
                      className={cn(
                        "relative flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-cyan px-1.5 text-[11px] font-semibold text-primary-foreground",
                        collapsed && "absolute top-1 right-1 h-4 min-w-4 px-1 text-[10px]",
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
