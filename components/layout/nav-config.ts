import {
  Activity,
  Bell,
  Building2,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  Users,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra hrefs that should also highlight this item. */
  matches?: string[];
  /** AI feature: rendered with the violet AI accent. */
  ai?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/**
 * Grouped product navigation (single source for the sidebar, mobile nav,
 * breadcrumbs and global search). Every route of the product stays reachable;
 * the asset classes live under one "Assets" entry with in-page tabs.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Vault",
    items: [
      { label: "Documents", href: "/documents", icon: FileText },
      { label: "Assets", href: "/assets", icon: Wallet },
      { label: "Video Legacy", href: "/video-legacy", icon: Video },
    ],
  },
  {
    label: "Legacy",
    items: [
      { label: "My Will", href: "/legacy-plan", icon: ScrollText },
      { label: "Beneficiaries", href: "/beneficiaries", icon: Users },
      { label: "Dead Man's Switch", href: "/dead-man-switch", icon: ShieldAlert },
      { label: "Emergency Access", href: "/emergency-access", icon: Siren },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "AI Assistant", href: "/ai", icon: Sparkles, ai: true },
      { label: "Activity Log", href: "/activity", icon: Activity },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Security", href: "/security-center", icon: ShieldCheck },
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/**
 * Operator navigation, shown only to a Super Admin (FR-P012).
 *
 * Kept out of `NAV_GROUPS` so the ordinary sidebar cannot render it by
 * accident; the page and every endpoint behind it re-check the role anyway.
 */
export const ADMIN_NAV_GROUP: NavGroup = {
  label: "Operations",
  items: [{ label: "Administration", href: "/admin", icon: Building2 }],
};

export const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/legacy-plan": "My Will",
  "/legacy-plan/wizard": "Create Will",
  "/beneficiaries": "Beneficiaries",
  "/assets": "Assets",
  "/assets/financial": "Financial Assets",
  "/assets/physical": "Physical Assets",
  "/assets/digital": "Digital Assets",
  "/documents": "Document Vault",
  "/video-legacy": "Video Legacy",
  "/dead-man-switch": "Dead Man's Switch",
  "/emergency-access": "Emergency Access",
  "/security-center": "Security Center",
  "/ai": "AI Assistant",
  "/activity": "Activity Log",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/admin": "Administration",
};

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Breadcrumb trail for a pathname, e.g. /assets/financial → Assets › Financial Assets. */
export function breadcrumbsFor(pathname: string): { label: string; href: string }[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    const label =
      PAGE_TITLES[current] ?? segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    crumbs.push({ label, href: current });
  }
  return crumbs;
}

export { HeartHandshake as BrandIcon };
