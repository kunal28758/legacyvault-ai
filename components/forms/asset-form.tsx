"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useDemoStore } from "@/lib/demo/store";
import type { AssetKind, DemoAsset, DemoAssetInput } from "@/lib/demo/types";
import {
  CURRENCIES,
  DIGITAL_CATEGORIES,
  FINANCIAL_CATEGORIES,
  PHYSICAL_CATEGORIES,
  digitalAssetSchema,
  financialAssetSchema,
  maskHint,
  physicalAssetSchema,
} from "@/lib/validators/asset.validators";
import { fieldErrors } from "@/lib/validators/legacy-plan.validators";

interface AssetFormSheetProps {
  kind: AssetKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: DemoAsset | null;
}

type Values = Record<string, string>;

const KIND_TITLE: Record<AssetKind, string> = {
  FINANCIAL_ASSET: "financial asset",
  PHYSICAL_ASSET: "physical asset",
  DIGITAL_ASSET: "digital asset",
};

function initialValues(kind: AssetKind, asset?: DemoAsset | null): Values {
  const common = {
    name: asset?.name ?? "",
    category: asset?.category ?? "",
    estimatedValue: asset?.estimatedValue != null ? String(asset.estimatedValue) : "",
    currency: asset?.currency ?? "INR",
    notes: asset?.notes ?? "",
  };
  if (kind === "FINANCIAL_ASSET") {
    const a = asset?.kind === "FINANCIAL_ASSET" ? asset : null;
    return { ...common, institution: a?.institution ?? "", accountNumber: "", policyNumber: "" };
  }
  if (kind === "PHYSICAL_ASSET") {
    const a = asset?.kind === "PHYSICAL_ASSET" ? asset : null;
    return {
      ...common,
      description: a?.description ?? "",
      location: a?.location ?? "",
      ownershipDetails: a?.ownershipDetails ?? "",
    };
  }
  const a = asset?.kind === "DIGITAL_ASSET" ? asset : null;
  return {
    ...common,
    platform: a?.platform ?? "",
    username: a?.username ?? "",
    credentials: "",
    recoveryInfo: "",
  };
}

/** Add / edit asset sheet. Sensitive inputs are write-only: the form keeps a masked hint, never the value. */
export function AssetFormSheet({ kind, open, onOpenChange, asset }: AssetFormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-md">
        <AssetForm kind={kind} asset={asset ?? null} onOpenChange={onOpenChange} />
      </SheetContent>
    </Sheet>
  );
}

/** Mounted fresh every time the sheet opens, so state initialises from props without effects. */
function AssetForm({
  kind,
  asset,
  onOpenChange,
}: {
  kind: AssetKind;
  asset: DemoAsset | null;
  onOpenChange: (open: boolean) => void;
}) {
  const addAsset = useDemoStore((s) => s.addAsset);
  const updateAsset = useDemoStore((s) => s.updateAsset);
  const [values, setValues] = useState<Values>(() => initialValues(kind, asset));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editing = Boolean(asset);

  const set = (field: string, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  };

  const categories =
    kind === "FINANCIAL_ASSET"
      ? FINANCIAL_CATEGORIES
      : kind === "PHYSICAL_ASSET"
        ? PHYSICAL_CATEGORIES
        : DIGITAL_CATEGORIES;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const schema =
      kind === "FINANCIAL_ASSET"
        ? financialAssetSchema
        : kind === "PHYSICAL_ASSET"
          ? physicalAssetSchema
          : digitalAssetSchema;
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    const d = parsed.data as Record<string, unknown>;
    const common = {
      name: String(d.name),
      estimatedValue: d.estimatedValue as number | null,
      currency: String(d.currency),
      notes: (d.notes as string) || null,
    };
    let payload: DemoAssetInput;
    if (kind === "FINANCIAL_ASSET") {
      const prev = asset?.kind === "FINANCIAL_ASSET" ? asset : null;
      payload = {
        kind,
        ...common,
        category: d.category as never,
        institution: (d.institution as string) || null,
        accountNumberHint: maskHint(d.accountNumber as string) ?? prev?.accountNumberHint ?? null,
        policyNumberHint: maskHint(d.policyNumber as string) ?? prev?.policyNumberHint ?? null,
      };
    } else if (kind === "PHYSICAL_ASSET") {
      payload = {
        kind,
        ...common,
        category: d.category as never,
        description: (d.description as string) || null,
        location: (d.location as string) || null,
        ownershipDetails: (d.ownershipDetails as string) || null,
      };
    } else {
      const prev = asset?.kind === "DIGITAL_ASSET" ? asset : null;
      payload = {
        kind,
        ...common,
        category: d.category as never,
        platform: (d.platform as string) || null,
        username: (d.username as string) || null,
        hasCredentials: Boolean(d.credentials) || Boolean(prev?.hasCredentials),
        hasRecoveryInfo: Boolean(d.recoveryInfo) || Boolean(prev?.hasRecoveryInfo),
      };
    }
    const result = asset ? updateAsset(asset.id, payload) : addAsset(payload);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(asset ? "Asset updated" : "Asset added", {
      description: "Sensitive fields are encrypted before storage in the live application.",
    });
    onOpenChange(false);
  };

  const sensitiveHint = (
    <span className="flex items-center gap-1">
      <Lock className="size-3" aria-hidden /> Encrypted (AES-256-GCM) — entered once, never
      displayed without re-verification.
    </span>
  );

  return (
    <>
      <form onSubmit={submit} className="flex h-full flex-col gap-6">
        <SheetHeader className="pr-10">
          <SheetTitle>
            {editing ? `Edit ${KIND_TITLE[kind]}` : `Add ${KIND_TITLE[kind]}`}
          </SheetTitle>
          <SheetDescription>
            Only you can see this record. Assign beneficiaries afterwards from the asset card.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 px-4">
          <FormField label="Name" required error={errors.name}>
            {(props) => (
              <Input {...props} value={values.name} onChange={(e) => set("name", e.target.value)} />
            )}
          </FormField>
          <FormField label="Category" required error={errors.category}>
            {(props) => (
              <Select
                value={values.category || null}
                onValueChange={(v) => set("category", String(v ?? ""))}
                items={categories}
              >
                <SelectTrigger
                  id={props.id}
                  className="w-full"
                  aria-invalid={props["aria-invalid"]}
                >
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          {kind === "FINANCIAL_ASSET" && (
            <>
              <FormField label="Institution" optional error={errors.institution}>
                {(props) => (
                  <Input
                    {...props}
                    value={values.institution}
                    onChange={(e) => set("institution", e.target.value)}
                    placeholder="Bank, insurer, broker"
                  />
                )}
              </FormField>
              <FormField
                label="Account number"
                optional
                hint={sensitiveHint}
                error={errors.accountNumber}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={values.accountNumber}
                    onChange={(e) => set("accountNumber", e.target.value)}
                    autoComplete="off"
                    placeholder={
                      asset?.kind === "FINANCIAL_ASSET" && asset.accountNumberHint
                        ? `Stored: ${asset.accountNumberHint}`
                        : ""
                    }
                  />
                )}
              </FormField>
              <FormField
                label="Policy number"
                optional
                hint={sensitiveHint}
                error={errors.policyNumber}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={values.policyNumber}
                    onChange={(e) => set("policyNumber", e.target.value)}
                    autoComplete="off"
                    placeholder={
                      asset?.kind === "FINANCIAL_ASSET" && asset.policyNumberHint
                        ? `Stored: ${asset.policyNumberHint}`
                        : ""
                    }
                  />
                )}
              </FormField>
            </>
          )}

          {kind === "PHYSICAL_ASSET" && (
            <>
              <FormField label="Description" optional error={errors.description}>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={values.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Location" optional error={errors.location}>
                {(props) => (
                  <Input
                    {...props}
                    value={values.location}
                    onChange={(e) => set("location", e.target.value)}
                    placeholder="City, address or safe location"
                  />
                )}
              </FormField>
              <FormField label="Ownership details" optional error={errors.ownershipDetails}>
                {(props) => (
                  <Input
                    {...props}
                    value={values.ownershipDetails}
                    onChange={(e) => set("ownershipDetails", e.target.value)}
                    placeholder="Sole owner, joint 50/50…"
                  />
                )}
              </FormField>
            </>
          )}

          {kind === "DIGITAL_ASSET" && (
            <>
              <FormField label="Platform" optional error={errors.platform}>
                {(props) => (
                  <Input
                    {...props}
                    value={values.platform}
                    onChange={(e) => set("platform", e.target.value)}
                    placeholder="Google, GoDaddy, Ledger…"
                  />
                )}
              </FormField>
              <FormField label="Username / handle" optional error={errors.username}>
                {(props) => (
                  <Input
                    {...props}
                    value={values.username}
                    onChange={(e) => set("username", e.target.value)}
                    autoComplete="off"
                  />
                )}
              </FormField>
              <FormField
                label="Credentials"
                optional
                hint={sensitiveHint}
                error={errors.credentials}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={values.credentials}
                    onChange={(e) => set("credentials", e.target.value)}
                    autoComplete="off"
                    placeholder={
                      asset?.kind === "DIGITAL_ASSET" && asset.hasCredentials
                        ? "Stored — leave blank to keep"
                        : ""
                    }
                  />
                )}
              </FormField>
              <FormField
                label="Recovery information"
                optional
                hint={sensitiveHint}
                error={errors.recoveryInfo}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={values.recoveryInfo}
                    onChange={(e) => set("recoveryInfo", e.target.value)}
                    autoComplete="off"
                    placeholder={
                      asset?.kind === "DIGITAL_ASSET" && asset.hasRecoveryInfo
                        ? "Stored — leave blank to keep"
                        : ""
                    }
                  />
                )}
              </FormField>
            </>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <FormField label="Estimated value" optional error={errors.estimatedValue}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  value={values.estimatedValue}
                  onChange={(e) => set("estimatedValue", e.target.value)}
                  placeholder="0"
                />
              )}
            </FormField>
            <FormField label="Currency">
              {(props) => (
                <Select
                  value={values.currency}
                  onValueChange={(v) => set("currency", String(v ?? "INR"))}
                  items={CURRENCIES.map((c) => ({ value: c, label: c }))}
                >
                  <SelectTrigger id={props.id} className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          </div>
          <FormField label="Notes" optional error={errors.notes}>
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={values.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            )}
          </FormField>
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit">{editing ? "Save changes" : "Add asset"}</Button>
        </SheetFooter>
      </form>
    </>
  );
}
