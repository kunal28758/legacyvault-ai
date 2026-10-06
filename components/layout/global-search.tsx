"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, FileText, Search, Users, Wallet } from "lucide-react";

import { NAV_GROUPS } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAssets } from "@/hooks/use-assets";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { useDocuments } from "@/hooks/use-documents";
import { ASSET_KIND_META } from "@/lib/assets/meta";
import { cn } from "@/lib/utils";

interface Result {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PAGES = NAV_GROUPS.flatMap((group) => group.items);
const LIMIT = 5;

const noSubscribe = () => () => {};
/** Apple keyboards label the shortcut ⌘ K; the server render (and everyone else) shows Ctrl K. */
const useIsApple = () =>
  useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  );

/**
 * Global search (⌘K / Ctrl+K). Pages match locally; documents, beneficiaries
 * and assets use each list endpoint's own `q` filter, so results are the
 * owner's real records and nothing is fetched until the palette is open and
 * the query is at least two characters long.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const isApple = useIsApple();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(handle);
  }, [input]);

  const enabled = open && q.length >= 2;
  const filters = { q, limit: LIMIT };
  const documents = useDocuments(filters, { enabled });
  const beneficiaries = useBeneficiaries(filters, { enabled });
  const financial = useAssets("FINANCIAL_ASSET", filters, { enabled });
  const physical = useAssets("PHYSICAL_ASSET", filters, { enabled });
  const digital = useAssets("DIGITAL_ASSET", filters, { enabled });

  const needle = input.trim().toLowerCase();
  const pages: Result[] = PAGES.filter(
    (page) => !needle || page.label.toLowerCase().includes(needle),
  ).map((page) => ({
    id: `page:${page.href}`,
    label: page.label,
    hint: "Page",
    href: page.href,
    icon: page.icon,
  }));

  const records: { heading: string; items: Result[] }[] = enabled
    ? [
        {
          heading: "Documents",
          items: (documents.data?.items ?? []).map((doc) => ({
            id: `doc:${doc.id}`,
            label: doc.name,
            hint: doc.shareCount ? `Shared with ${doc.shareCount}` : "Private",
            href: `/documents?q=${encodeURIComponent(doc.name)}`,
            icon: FileText,
          })),
        },
        {
          heading: "Beneficiaries",
          items: (beneficiaries.data?.items ?? []).map((person) => ({
            id: `ben:${person.id}`,
            label: person.name,
            hint: person.relationship,
            href: `/beneficiaries?q=${encodeURIComponent(person.name)}`,
            icon: Users,
          })),
        },
        {
          heading: "Assets",
          items: [financial, physical, digital].flatMap((query) =>
            (query.data?.items ?? []).map(({ asset }) => ({
              id: `asset:${asset.id}`,
              label: asset.name,
              hint: ASSET_KIND_META[asset.kind].plural,
              href: `${ASSET_KIND_META[asset.kind].href}?q=${encodeURIComponent(asset.name)}`,
              icon: Wallet,
            })),
          ),
        },
      ].filter((group) => group.items.length > 0)
    : [];

  const searching =
    enabled &&
    [documents, beneficiaries, financial, physical, digital].some((query) => query.isFetching);
  const groups = [{ heading: "Pages", items: pages }, ...records].filter((g) => g.items.length);
  const first = groups[0]?.items[0];

  const go = (href: string) => {
    setOpen(false);
    setInput("");
    router.push(href);
  };

  // Arrow keys move focus through the result links; Enter in the field opens the first.
  const moveFocus = (event: React.KeyboardEvent, delta: number) => {
    const links = Array.from(listRef.current?.querySelectorAll<HTMLElement>("a") ?? []);
    if (!links.length) return;
    event.preventDefault();
    const index = links.indexOf(document.activeElement as HTMLElement);
    links[(index + delta + links.length) % links.length]?.focus();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group hidden h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-input bg-surface/60 px-3 text-left text-sm text-muted-foreground transition-[border-color,background-color] duration-150 outline-none hover:border-primary/35 hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/50 md:flex"
        aria-label="Search documents, assets and beneficiaries"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search className="size-4 shrink-0 transition-colors group-hover:text-primary" />
        <span className="flex-1 truncate">Search documents, assets, beneficiaries…</span>
        <kbd className="hidden rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium lg:inline">
          {isApple ? "⌘ K" : "Ctrl K"}
        </kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Search"
        onClick={() => setOpen(true)}
      >
        <Search />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[10vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Find pages, documents, beneficiaries and assets in your vault.
          </DialogDescription>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-primary" aria-hidden />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") moveFocus(event, 1);
                if (event.key === "Enter" && first) go(first.href);
              }}
              placeholder="Search documents, assets, beneficiaries…"
              aria-label="Search query"
              className="h-14 flex-1 bg-transparent pr-8 text-[15px] outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <div className="max-h-[min(60vh,28rem)] overflow-y-auto p-2" aria-busy={searching}>
            {groups.length === 0 && !searching ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                Nothing matches “{input.trim()}”.
              </p>
            ) : (
              <ul
                ref={listRef}
                aria-label="Search results"
                className="space-y-3"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") moveFocus(event, 1);
                  if (event.key === "ArrowUp") moveFocus(event, -1);
                }}
              >
                {groups.map((group) => (
                  <li key={group.heading}>
                    <p className="px-3 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">
                      {group.heading}
                    </p>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <Link
                            href={item.href}
                            onClick={(event) => {
                              event.preventDefault();
                              go(item.href);
                            }}
                            className={cn(
                              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none",
                              "hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:ring-1 focus-visible:ring-primary/40",
                            )}
                          >
                            <span className="icon-tile size-8 text-primary">
                              <item.icon className="size-4" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{item.label}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {item.hint}
                              </span>
                            </span>
                            <ArrowRight
                              className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                              aria-hidden
                            />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {searching && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Searching your vault…</p>
            )}
            {!enabled && input.trim().length > 0 && input.trim().length < 2 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Type at least two characters to search your records.
              </p>
            )}
          </div>
          <div className="flex items-center gap-4 border-t border-border bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CornerDownLeft className="size-3" aria-hidden /> open first result
            </span>
            <span>↑ ↓ move</span>
            <span>Esc close</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
