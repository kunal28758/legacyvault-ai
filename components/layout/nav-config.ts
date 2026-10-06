import {
  Activity,
  Bell,
  Building2,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  ListChecks,
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
 * Product information architecture: nine areas, each a nav group (single source
 * for the sidebar, mobile nav, breadcrumbs and the command palette). Existing
 * routes keep their URLs; only labels and grouping changed.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Command Centre",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Action Centre", href: "/actions", icon: ListChecks },
    ],
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
    label: "Legacy Planning",
    items: [
      { label: "My Will", href: "/legacy-plan", icon: ScrollText },
      { label: "Life Events", href: "/life-events", icon: HeartHandshake },
    ],
  },
  {
    label: "Family & Beneficiaries",
    items: [{ label: "Beneficiaries", href: "/beneficiaries", icon: Users }],
  },
  {
    label: "Emergency",
    items: [
      { label: "Dead Man's Switch", href: "/dead-man-switch", icon: ShieldAlert },
      { label: "Emergency Access", href: "/emergency-access", icon: Siren },
    ],
  },
  {
    label: "Intelligence",
    items: [{ label: "AI Copilot", href: "/ai", icon: Sparkles, ai: true }],
  },
  {
    label: "Security",
    items: [{ label: "Security Centre", href: "/security-center", icon: ShieldCheck }],
  },
  {
    label: "Activity & Audit",
    items: [{ label: "Audit Centre", href: "/activity", icon: Activity }],
  },
  {
    label: "Settings",
    items: [
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
  "/actions": "Action Centre",
  "/life-events": "Life Events",
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
  "/security-center": "Security Centre",
  "/ai": "AI Copilot",
  "/activity": "Audit Centre",
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
