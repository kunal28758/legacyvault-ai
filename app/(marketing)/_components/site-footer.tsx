import Link from "next/link";

import { BrandLogo } from "@/components/shared/brand-logo";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Capabilities", href: "#capabilities" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Security", href: "#security" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/sign-in" },
      { label: "Create account", href: "/sign-up" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-glass-border">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <BrandLogo />
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            Security-first legal-tech platform to organize, protect and transfer your digital and
            physical legacy to the people you trust.
          </p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <p className="text-sm font-semibold">{column.title}</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith("#") ? (
                    <a href={link.href} className="hover:text-foreground">
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className="hover:text-foreground">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-glass-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} LegacyVault AI · Baseline in development</p>
          <p className="max-w-xl">
            LegacyVault AI provides informational assistance and secure organization. It is not a
            law firm, does not provide legal advice, and does not guarantee the legal validity of
            any document or outcome.
          </p>
        </div>
      </div>
    </footer>
  );
}
