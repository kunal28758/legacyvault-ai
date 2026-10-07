"use client";

import { useState } from "react";
import { FileText, Link2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLinkDocument } from "@/hooks/use-documents";
import { ApiError } from "@/lib/client/api-client";
import type { AssetKind } from "@/lib/types/asset";

interface Choice {
  id: string;
  label: string;
  hint: string;
  /** Already linked: listed (so the owner sees it) but not selectable. */
  linked?: boolean;
}

type LinkTarget =
  | {
      /** Pick documents to support this asset. */
      mode: "asset";
      asset: { id: string; kind: AssetKind; name: string };
      choices: Choice[];
    }
  | {
      /** Pick the asset this document supports. */
      mode: "document";
      document: { id: string; name: string };
      choices: (Choice & { kind: AssetKind })[];
    };

/**
 * Links a document to an asset as supporting evidence. Both directions use the
 * same audited `attach_document()` call, which re-checks that the document and
 * the asset belong to the caller. Nothing is linked until the owner chooses.
 */
export function LinkDocumentDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: LinkTarget | null;
}) {
  const link = useLinkDocument();
  const [query, setQuery] = useState("");
  const [linked, setLinked] = useState<string[]>([]);

  if (!target) return null;
  const needle = query.trim().toLowerCase();
  const visible = target.choices.filter(
    (choice) => !needle || choice.label.toLowerCase().includes(needle),
  );
  const title =
    target.mode === "asset"
      ? `Link documents to ${target.asset.name}`
      : `Link ${target.document.name} to an asset`;

  const choose = async (choice: Choice & { kind?: AssetKind }) => {
    try {
      if (target.mode === "asset") {
        await link.mutateAsync({
          documentId: choice.id,
          resourceType: target.asset.kind,
          resourceId: target.asset.id,
        });
      } else {
        await link.mutateAsync({
          documentId: target.document.id,
          resourceType: choice.kind!,
          resourceId: choice.id,
        });
      }
      setLinked((previous) => [...previous, choice.id]);
      toast.success(`${choice.label} linked`);
      if (target.mode === "document") onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not link this document.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setLinked([]);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="glass-strong sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {target.mode === "asset"
              ? "Choose the deeds, statements or policies that prove this asset. Linking never shares a document with anyone."
              : "Choose the asset this document supports. Linking never shares it with anyone."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={target.mode === "asset" ? "Search documents" : "Search assets"}
            aria-label={target.mode === "asset" ? "Search documents" : "Search assets"}
            className="pl-8"
          />
        </div>
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {target.choices.length === 0
              ? target.mode === "asset"
                ? "Your vault has no documents yet. Upload one, then link it here."
                : "Record an asset first, then link this document to it."
              : "Nothing matches that search."}
          </p>
        ) : (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1" aria-label="Choices">
            {visible.map((choice) => {
              const done = choice.linked || linked.includes(choice.id);
              const Icon = target.mode === "asset" ? FileText : Wallet;
              return (
                <li
                  key={choice.id}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{choice.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {choice.hint}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant={done ? "ghost" : "outline"}
                    disabled={done || link.isPending}
                    onClick={() => void choose(choice)}
                    aria-label={`Link ${choice.label}`}
                  >
                    <Link2 data-icon="inline-start" />
                    {done ? "Linked" : "Link"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
