import {
  Bell,
  Bot,
  Coins,
  FileText,
  Gem,
  Globe,
  HeartHandshake,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  TimerReset,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra hrefs that should also highlight this item. */
  matches?: string[];
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/** Grouped product navigation (single source for the sidebar, mobile nav and breadcrumbs). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Legacy",
    items: [
      { label: "Create / Continue Will", href: "/legacy-plan/wizard", icon: ScrollText },
      { label: "Legacy Plan", href: "/legacy-plan", icon: FileText },
    ],
  },
  {
    label: "People",
    items: [{ label: "Beneficiaries", href: "/beneficiaries", icon: Users }],
  },
  {
    label: "Assets",
    items: [
      { label: "Financial Assets", href: "/assets/financial", icon: Coins },
      { label: "Physical Assets", href: "/assets/physical", icon: Gem },
      { label: "Digital Assets", href: "/assets/digital", icon: Globe },
    ],
  },
  {
    label: "Vault",
    items: [
      { label: "Documents", href: "/documents", icon: FileText },
      { label: "Video Legacy", href: "/video-legacy", icon: Video },
    ],
  },
  {
    label: "Protection",
    items: [
      { label: "Dead Man's Switch", href: "/dead-man-switch", icon: TimerReset },
      { label: "Emergency Access", href: "/emergency-access", icon: Siren },
      { label: "Security Center", href: "/security-center", icon: ShieldCheck },
    ],
  },
  {
    label: "AI",
    items: [{ label: "AI Assistant", href: "/ai", icon: Bot }],
  },
  {
    label: "System",
    items: [
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/legacy-plan": "Legacy Plan",
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
  "/notifications": "Notifications",
  "/settings": "Settings",
};

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/legacy-plan") return pathname === "/legacy-plan";
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
