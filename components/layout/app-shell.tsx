"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useClerk } from "@clerk/nextjs";
import {
  Bell,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { GlobalSearch } from "@/components/layout/global-search";
import { PAGE_TITLES, breadcrumbsFor } from "@/components/layout/nav-config";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { SystemStatusIndicator } from "@/components/layout/system-status-indicator";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { BrandLogo } from "@/components/shared/brand-logo";
import { PageTransition } from "@/components/shared/page-transition";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { useUnreadCount } from "@/hooks/use-notifications";
import { useProfile, useUpdatePreferences } from "@/hooks/use-profile";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ShellUser {
  name: string;
  email: string | null;
  imageUrl: string | null;
}

interface AppShellProps {
  user: ShellUser;
  /** Clerk is configured on this deployment (renders the real account menu). */
  clerkEnabled: boolean;
  children: React.ReactNode;
}

/**
 * Authenticated application shell: collapsible glass sidebar with grouped
 * navigation and the account card (desktop), sheet navigation (mobile), and a
 * header with breadcrumbs, global search, security state, system status,
 * notifications and the account menu.
 */
export function AppShell({ user, clerkEnabled, children }: AppShellProps) {
  const pathname = usePathname();
  const unreadQuery = useUnreadCount();
  const profile = useProfile();
  const updatePreferences = useUpdatePreferences();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Honours the idle sign-out the person chose in Settings (FR-A008).
  useIdleTimeout();

  const compact =
    (profile.data?.preferences as { compactSidebar?: boolean } | undefined)?.compactSidebar ??
    false;
  const unread = unreadQuery.data?.count ?? 0;
  const badges: Record<string, number> = unread ? { "/notifications": unread } : {};
  const crumbs = breadcrumbsFor(pathname);
  const title = PAGE_TITLES[pathname] ?? crumbs.at(-1)?.label ?? "LegacyVault";
  const toggleCompact = () =>
    updatePreferences.mutate({
      preferences: { ...(profile.data?.preferences ?? {}), compactSidebar: !compact },
    });

  return (
    <div className="relative flex min-h-dvh bg-background">
      {/* Ambient light: a faint blue wash from the top of the workspace. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-gradient-surface" />

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 z-20 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar/85 backdrop-blur-xl transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex",
          compact ? "w-[76px]" : "w-[264px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center justify-between gap-2 px-4",
            compact && "justify-center px-0",
          )}
        >
          <BrandLogo href="/dashboard" compact={compact} />
          {!compact && (
            <CollapseButton compact={compact} onToggle={toggleCompact} className="-mr-1" />
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1 px-3 pt-2 pb-4">
          <SidebarNav collapsed={compact} badges={badges} />
        </ScrollArea>
        <div className={cn("p-3", compact && "flex flex-col items-center gap-2")}>
          {compact && <CollapseButton compact={compact} onToggle={toggleCompact} />}
          <AccountMenu user={user} clerkEnabled={clerkEnabled} compact={compact} />
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border/70 bg-background/70 px-3 backdrop-blur-xl sm:gap-3 sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[86vw] max-w-[300px] gap-0 border-sidebar-border bg-sidebar p-0"
            >
              <SheetHeader className="h-16 justify-center px-4">
                <BrandLogo href="/dashboard" />
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SheetDescription className="sr-only">Primary product navigation</SheetDescription>
              </SheetHeader>
              <ScrollArea className="min-h-0 flex-1 px-3 py-2">
                <SidebarNav badges={badges} onNavigate={() => setMobileOpen(false)} />
              </ScrollArea>
              <div className="border-t border-sidebar-border p-3">
                <AccountMenu user={user} clerkEnabled={clerkEnabled} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="min-w-0 shrink-0 md:w-48 xl:w-60">
            <nav
              aria-label="Breadcrumb"
              className="hidden items-center gap-1 text-xs text-muted-foreground md:flex"
            >
              <Link href="/dashboard" className="transition-colors hover:text-foreground">
                Home
              </Link>
              {crumbs.map((crumb, index) => (
                <span key={crumb.href} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />
                  {index === crumbs.length - 1 ? (
                    <span aria-current="page" className="truncate font-medium text-foreground">
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href}
                      className="truncate transition-colors hover:text-foreground"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
            <p className="truncate font-heading text-[15px] font-semibold md:hidden">{title}</p>
          </div>

          <div className="flex flex-1 justify-end md:justify-center">
            <GlobalSearch />
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <SecurityChip mfaEnabled={profile.data?.mfaEnabled} />
            <SystemStatusIndicator compact className="hidden sm:flex" />
            <ThemeToggle className="hidden sm:inline-flex" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
                    nativeButton={false}
                    render={<Link href="/notifications" />}
                  />
                }
              >
                <Bell />
                {unread > 0 && (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 flex h-4 min-w-4 animate-in items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-background duration-300 zoom-in-50"
                  >
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">Notifications</TooltipContent>
            </Tooltip>

            {clerkEnabled ? (
              <span className="ml-1 flex size-9 items-center justify-center">
                <UserButton
                  appearance={{
                    elements: {
                      userButtonAvatarBox: "size-8 ring-2 ring-primary/30 ring-offset-0",
                    },
                  }}
                  userProfileUrl="/settings"
                  userProfileMode="navigation"
                />
              </span>
            ) : (
              <Avatar size="sm" className="ml-1">
                {user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
            )}
          </div>
        </header>

        <main id="main" className="relative flex flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
    </div>
  );
}

function CollapseButton({
  compact,
  onToggle,
  className,
}: {
  compact: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = compact ? "Expand sidebar" : "Collapse sidebar";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground", className)}
            aria-label={label}
            aria-pressed={compact}
            onClick={onToggle}
          />
        }
      >
        {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Account health at a glance: whether a second factor protects the sign-in. */
function SecurityChip({ mfaEnabled }: { mfaEnabled: boolean | undefined }) {
  if (mfaEnabled === undefined) return null;
  const Icon = mfaEnabled ? ShieldCheck : ShieldAlert;
  return (
    <Link
      href={mfaEnabled ? "/security-center" : "/settings?tab=security"}
      aria-label={
        mfaEnabled
          ? "Security: two-factor authentication is on"
          : "Security: two-factor authentication is off"
      }
      className={cn(
        "hidden h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 xl:flex",
        mfaEnabled
          ? "border-success/25 bg-success/10 text-success hover:bg-success/15"
          : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {mfaEnabled ? "2FA on" : "2FA off"}
    </Link>
  );
}

function AccountMenu({
  user,
  clerkEnabled,
  compact = false,
}: {
  user: ShellUser;
  clerkEnabled: boolean;
  compact?: boolean;
}) {
  const avatar = (
    <Avatar size="sm" className="ring-2 ring-primary/25">
      {user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
      <AvatarFallback className="bg-primary/15 font-semibold text-primary">
        {initials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account menu"
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-2 text-left transition-colors outline-none hover:border-primary/30 hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50",
              compact && "w-auto justify-center rounded-full border-transparent bg-transparent p-1",
            )}
          />
        }
      >
        {avatar}
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {user.email ?? "Signed in"}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
            <p className="truncate text-xs">{user.email ?? "Signed in"}</p>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/settings" />}>
            <UserRound /> Profile
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/security-center" />}>
            <ShieldCheck /> Security
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/settings?tab=preferences" />}>
            <Settings /> Preferences
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {clerkEnabled ? (
          <SignOutItem />
        ) : (
          <DropdownMenuItem disabled>
            <LogOut /> Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Rendered only when Clerk is configured, so `useClerk` always has its provider. */
function SignOutItem() {
  const clerk = useClerk();
  return (
    <DropdownMenuItem
      variant="destructive"
      onClick={() => void clerk.signOut({ redirectUrl: "/" })}
    >
      <LogOut /> Sign out
    </DropdownMenuItem>
  );
}
