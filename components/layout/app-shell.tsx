"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  Bell,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { PAGE_TITLES, breadcrumbsFor } from "@/components/layout/nav-config";
import { SidebarNav } from "@/components/layout/sidebar-nav";
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
 * Authenticated application shell: collapsible sidebar (desktop), sheet
 * navigation (mobile), header with breadcrumbs, notifications, theme and account.
 */
export function AppShell({ user, clerkEnabled, children }: AppShellProps) {
  const pathname = usePathname();
  const unreadQuery = useUnreadCount();
  const profile = useProfile();
  const updatePreferences = useUpdatePreferences();
  const [mobileOpen, setMobileOpen] = useState(false);

  const compact =
    (profile.data?.preferences as { compactSidebar?: boolean } | undefined)?.compactSidebar ??
    false;
  const unread = unreadQuery.data?.count ?? 0;
  const badges: Record<string, number> = unread ? { "/notifications": unread } : {};
  const crumbs = breadcrumbsFor(pathname);
  const title = PAGE_TITLES[pathname] ?? crumbs.at(-1)?.label ?? "LegacyVault";

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur-xl transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex",
          compact ? "w-[76px]" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-sidebar-border px-4",
            compact && "justify-center px-0",
          )}
        >
          <BrandLogo href="/dashboard" compact={compact} />
        </div>
        <ScrollArea className="min-h-0 flex-1 px-3 py-4">
          <SidebarNav collapsed={compact} badges={badges} />
        </ScrollArea>
        <div
          className={cn(
            "border-t border-sidebar-border p-3",
            compact && "flex flex-col items-center gap-2",
          )}
        >
          {!compact && (
            <div className="mb-2 flex items-center gap-3 rounded-lg px-2 py-1.5">
              <Avatar size="sm">
                {user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
                <AvatarFallback>{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email ?? "Signed in"}
                </p>
              </div>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size={compact ? "icon" : "sm"}
                  className={cn("w-full justify-start text-muted-foreground", compact && "w-auto")}
                  aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
                  aria-pressed={compact}
                  onClick={() =>
                    updatePreferences.mutate({
                      preferences: {
                        ...(profile.data?.preferences ?? {}),
                        compactSidebar: !compact,
                      },
                    })
                  }
                />
              }
            >
              {compact ? <PanelLeftOpen /> : <PanelLeftClose data-icon="inline-start" />}
              {!compact && "Collapse"}
            </TooltipTrigger>
            <TooltipContent side="right">
              {compact ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl sm:px-6">
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
            <SheetContent side="left" className="w-[85vw] max-w-xs p-0 glass-strong">
              <SheetHeader className="border-b border-border px-4 py-4">
                <BrandLogo href="/dashboard" />
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SheetDescription className="sr-only">Primary product navigation</SheetDescription>
              </SheetHeader>
              <ScrollArea className="h-[calc(100dvh-5rem)] px-3 py-4">
                <SidebarNav badges={badges} onNavigate={() => setMobileOpen(false)} />
              </ScrollArea>
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <nav
              aria-label="Breadcrumb"
              className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"
            >
              <Link href="/dashboard" className="hover:text-foreground">
                Home
              </Link>
              {crumbs.map((crumb, index) => (
                <span key={crumb.href} className="flex items-center gap-1">
                  <ChevronRight className="size-3" aria-hidden />
                  {index === crumbs.length - 1 ? (
                    <span aria-current="page" className="text-foreground">
                      {crumb.label}
                    </span>
                  ) : (
                    <Link href={crumb.href} className="hover:text-foreground">
                      {crumb.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
            <p className="truncate text-sm font-semibold sm:hidden">{title}</p>
          </div>

          <ThemeToggle />
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
                  className="absolute top-1.5 right-1.5 flex size-2 rounded-full bg-brand-cyan ring-2 ring-background"
                />
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom">Notifications</TooltipContent>
          </Tooltip>

          {clerkEnabled ? (
            <UserButton
              appearance={{ elements: { userButtonAvatarBox: "size-8" } }}
              userProfileUrl="/settings"
              userProfileMode="navigation"
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Account menu"
                    className="rounded-full"
                  />
                }
              >
                <Avatar size="sm">
                  {user.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}
                  <AvatarFallback>{initials(user.name)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium text-foreground">{user.name}</p>
                  <p className="truncate text-xs">{user.email ?? "Signed in"}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link href="/settings" />}>
                    <UserRound /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/settings?tab=security" />}>
                    <ShieldCheck /> Security
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/settings?tab=preferences" />}>
                    <Settings /> Preferences
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>
                  <LogOut /> Sign out (Clerk)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        <main id="main" className="flex flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
    </div>
  );
}
