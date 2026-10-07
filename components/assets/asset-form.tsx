"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { FormField } from "@/components/shared/form-field";
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
import { useCreateAsset, useUpdateAsset, type AssetFormValues } from "@/hooks/use-assets";
import { useBeneficiaries } from "@/hooks/use-beneficiaries";
import { ApiError } from "@/lib/client/api-client";
import type { Asset, AssetKind } from "@/lib/types/asset";
import {
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  assetProfileSchema,
  cleanAssetProfile,
  type AssetProfile,
} from "@/lib/validators/asset-profile";
import {
  CURRENCIES,
  DIGITAL_CATEGORIES,
  FINANCIAL_CATEGORIES,
  PHYSICAL_CATEGORIES,
  digitalAssetSchema,
  financialAssetSchema,
  physicalAssetSchema,
} from "@/lib/validators/asset.validators";
import { fieldErrors } from "@/lib/validators/legacy-plan.validators";

interface AssetFormSheetProps {
  kind: AssetKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset | null;
}

type Values = Record<string, string>;

const KIND_TITLE: Record<AssetKind, string> = {
  FINANCIAL_ASSET: "financial asset",
  PHYSICAL_ASSET: "physical asset",
  DIGITAL_ASSET: "digital asset",
};

function initialValues(kind: AssetKind, asset?: Asset | null): Values {
  const common = {
    name: asset?.name ?? "",
    category: asset?.category ?? "",
    estimatedValue: asset?.estimatedValue != null ? String(asset.estimatedValue) : "",
    currency: asset?.currency ?? "INR",
    notes: asset?.notes ?? "",
  };
  if (kind === "FINANCIAL_ASSET") {
    const financial = asset?.kind === "FINANCIAL_ASSET" ? asset : null;
    return {
      ...common,
      institution: financial?.institution ?? "",
      accountNumber: "",
      policyNumber: "",
    };
  }
  if (kind === "PHYSICAL_ASSET") {
    const physical = asset?.kind === "PHYSICAL_ASSET" ? asset : null;
    return {
      ...common,
      description: physical?.description ?? "",
      location: physical?.location ?? "",
      ownershipDetails: physical?.ownershipDetails ?? "",
    };
  }
  return { ...common, platform: "", username: "", credentials: "", recoveryInfo: "" };
}

type ProfileValues = Record<
  | "status"
  | "acquiredOn"
  | "reviewOn"
  | "expiresOn"
  | "lastReviewedOn"
  | "nomineeName"
  | "nomineeRelationship"
  | "nomineeBeneficiaryId"
  | "instructions",
  string
>;

function initialProfile(asset?: Asset | null): ProfileValues {
  const profile = asset?.profile ?? {};
  return {
    status: profile.status ?? "ACTIVE",
    acquiredOn: profile.acquiredOn ?? "",
    reviewOn: profile.reviewOn ?? "",
    expiresOn: profile.expiresOn ?? "",
    lastReviewedOn: profile.lastReviewedOn ?? "",
    nomineeName: profile.nominee?.name ?? "",
    nomineeRelationship: profile.nominee?.relationship ?? "",
    nomineeBeneficiaryId: profile.nominee?.beneficiaryId ?? "",
    instructions: profile.instructions ?? "",
  };
}

function toProfile(values: ProfileValues): AssetProfile {
  const text = (value: string) => value.trim() || null;
  return {
    status: values.status === "ACTIVE" ? null : (values.status as AssetProfile["status"]),
    acquiredOn: text(values.acquiredOn),
    reviewOn: text(values.reviewOn),
    expiresOn: text(values.expiresOn),
    lastReviewedOn: text(values.lastReviewedOn),
    nominee: values.nomineeName.trim()
      ? {
          name: values.nomineeName.trim(),
          relationship: text(values.nomineeRelationship),
          beneficiaryId: text(values.nomineeBeneficiaryId),
        }
      : null,
    instructions: text(values.instructions),
  };
}

/**
 * Add / edit asset sheet.
 *
 * Sensitive inputs are write-only: they always start blank, because the stored
 * value is encrypted and is never sent to the browser. Leaving one blank keeps
 * whatever is stored; typing into one replaces it through
 * `set_encrypted_fields()`.
 */
export function AssetFormSheet({ kind, open, onOpenChange, asset }: AssetFormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-lg">
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
  asset: Asset | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateAsset(kind);
  const update = useUpdateAsset(kind);
  const [values, setValues] = useState<Values>(() => initialValues(kind, asset));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<ProfileValues>(() => initialProfile(asset));
  const beneficiaries = useBeneficiaries();
  const editing = Boolean(asset);
  const busy = create.isPending || update.isPending;

  const digital = asset?.kind === "DIGITAL_ASSET" ? asset : null;
  const financial = asset?.kind === "FINANCIAL_ASSET" ? asset : null;

  const set = (field: string, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] ? { ...previous, [field]: "" } : previous));
  };
  const setLegacy = (field: keyof ProfileValues, value: string) => {
    setProfile((previous) => ({ ...previous, [field]: value }));
    const key = `profile.${field}`;
    setErrors((previous) => (previous[key] ? { ...previous, [key]: "" } : previous));
  };

  const categories =
    kind === "FINANCIAL_ASSET"
      ? FINANCIAL_CATEGORIES
      : kind === "PHYSICAL_ASSET"
        ? PHYSICAL_CATEGORIES
        : DIGITAL_CATEGORIES;

  const applyServerError = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.fields) {
        const mapped: Record<string, string> = {};
        for (const [field, messages] of Object.entries(error.fields)) {
          if (messages[0]) mapped[field] = messages[0];
        }
        if (Object.keys(mapped).length > 0) {
          setErrors(mapped);
          return;
        }
      }
      toast.error(error.message);
      return;
    }
    toast.error("Could not save this asset. Please try again.");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const schema =
      kind === "FINANCIAL_ASSET"
        ? financialAssetSchema
        : kind === "PHYSICAL_ASSET"
          ? physicalAssetSchema
          : digitalAssetSchema;
    const parsed = schema.safeParse(values);
    const legacy = assetProfileSchema.safeParse(toProfile(profile));
    if (!parsed.success || !legacy.success) {
      const legacyErrors: Record<string, string> = {};
      for (const issue of legacy.error?.issues ?? []) {
        const [head, sub] = issue.path.map(String);
        // nominee.name → the "nomineeName" input, and so on.
        const field =
          head === "nominee"
            ? `nominee${(sub ?? "name").replace(/^./, (c) => c.toUpperCase())}`
            : head;
        legacyErrors[`profile.${field}`] ??= issue.message;
      }
      setErrors({ ...(parsed.success ? {} : fieldErrors(parsed.error)), ...legacyErrors });
      return;
    }

    const data = parsed.data as Record<string, unknown>;
    const text = (key: string): string | null => {
      const value = data[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    /** Only send a secret the user actually typed; absent means "keep stored". */
    const secret = (key: string): string | undefined => text(key) ?? undefined;

    const payload: AssetFormValues = {
      name: String(data.name),
      category: String(data.category),
      estimatedValue: (data.estimatedValue as number | null) ?? null,
      currency: String(data.currency),
      notes: text("notes"),
    };

    if (kind === "FINANCIAL_ASSET") {
      payload.institution = text("institution");
      payload.accountNumber = secret("accountNumber");
      payload.policyNumber = secret("policyNumber");
    } else if (kind === "PHYSICAL_ASSET") {
      payload.description = text("description");
      payload.location = text("location");
      payload.ownershipDetails = text("ownershipDetails");
    } else {
      payload.platform = text("platform");
      payload.username = text("username");
      payload.credentials = secret("credentials");
      payload.recoveryInfo = secret("recoveryInfo");
    }

    // On edit the profile is always sent, so a cleared field is really cleared;
    // on create it is sent only when something was filled in.
    if (asset || cleanAssetProfile(legacy.data)) payload.profile = legacy.data;

    try {
      if (asset) {
        await update.mutateAsync({ id: asset.id, values: payload });
        toast.success("Asset updated");
      } else {
        await create.mutateAsync(payload);
        toast.success("Asset added", {
          description: "Sensitive fields were encrypted before storage.",
        });
      }
      onOpenChange(false);
    } catch (error) {
      applyServerError(error);
    }
  };

  const sensitiveHint = (
    <span className="flex items-center gap-1">
      <Lock className="size-3" aria-hidden /> Encrypted (AES-256-GCM) — entered once, never
      displayed without re-verification.
    </span>
  );

  return (
    <form onSubmit={submit} className="flex h-full flex-col gap-6">
      <SheetHeader className="pr-10">
        <SheetTitle>{editing ? `Edit ${KIND_TITLE[kind]}` : `Add ${KIND_TITLE[kind]}`}</SheetTitle>
        <SheetDescription>
          Only you can see this record. Assign beneficiaries afterwards from the asset card.
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-5 px-4">
        <FormField label="Name" required error={errors.name}>
          {(props) => (
            <Input
              {...props}
              value={values.name}
              onChange={(event) => set("name", event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Category" required error={errors.category}>
          {(props) => (
            <Select
              value={values.category || null}
              onValueChange={(value) => set("category", String(value ?? ""))}
              items={categories}
            >
              <SelectTrigger id={props.id} className="w-full" aria-invalid={props["aria-invalid"]}>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category) => (
                  <SelectItem key={category.value} value={category.value}>
                    {category.label}
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
                  onChange={(event) => set("institution", event.target.value)}
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
                  onChange={(event) => set("accountNumber", event.target.value)}
                  autoComplete="off"
                  placeholder={financial?.hasAccountNumber ? "Stored — leave blank to keep" : ""}
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
                  onChange={(event) => set("policyNumber", event.target.value)}
                  autoComplete="off"
                  placeholder={financial?.hasPolicyNumber ? "Stored — leave blank to keep" : ""}
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
                  onChange={(event) => set("description", event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Location" optional error={errors.location}>
              {(props) => (
                <Input
                  {...props}
                  value={values.location}
                  onChange={(event) => set("location", event.target.value)}
                  placeholder="City, address or safe location"
                />
              )}
            </FormField>
            <FormField label="Ownership details" optional error={errors.ownershipDetails}>
              {(props) => (
                <Input
                  {...props}
                  value={values.ownershipDetails}
                  onChange={(event) => set("ownershipDetails", event.target.value)}
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
                  onChange={(event) => set("platform", event.target.value)}
                  placeholder="Google, GoDaddy, Ledger…"
                />
              )}
            </FormField>
            <FormField label="Username / handle" optional error={errors.username}>
              {(props) => (
                <Input
                  {...props}
                  value={values.username}
                  onChange={(event) => set("username", event.target.value)}
                  autoComplete="off"
                />
              )}
            </FormField>
            <FormField label="Credentials" optional hint={sensitiveHint} error={errors.credentials}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  value={values.credentials}
                  onChange={(event) => set("credentials", event.target.value)}
                  autoComplete="off"
                  placeholder={digital?.hasCredentials ? "Stored — leave blank to keep" : ""}
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
                  onChange={(event) => set("recoveryInfo", event.target.value)}
                  autoComplete="off"
                  placeholder={digital?.hasRecoveryInfo ? "Stored — leave blank to keep" : ""}
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
                onChange={(event) => set("estimatedValue", event.target.value)}
                placeholder="0"
              />
            )}
          </FormField>
          <FormField label="Currency">
            {(props) => (
              <Select
                value={values.currency}
                onValueChange={(value) => set("currency", String(value ?? "INR"))}
                items={CURRENCIES.map((currency) => ({ value: currency, label: currency }))}
              >
                <SelectTrigger id={props.id} className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((currency) => (
                    <SelectItem key={currency} value={currency}>
                      {currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </div>
        <fieldset className="space-y-4 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Legacy details</legend>
          <p className="-mt-1 text-xs text-muted-foreground">
            Used by Legacy Intelligence to check this asset against your Will, documents and
            beneficiaries. Only you can see these details.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Status" error={errors["profile.status"]}>
              {(props) => (
                <Select
                  value={profile.status}
                  onValueChange={(value) => setLegacy("status", String(value ?? "ACTIVE"))}
                  items={ASSET_STATUSES.map((value) => ({
                    value,
                    label: ASSET_STATUS_LABELS[value],
                  }))}
                >
                  <SelectTrigger id={props.id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ASSET_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField label="Acquired on" optional error={errors["profile.acquiredOn"]}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={profile.acquiredOn}
                  onChange={(event) => setLegacy("acquiredOn", event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Review on" optional error={errors["profile.reviewOn"]}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={profile.reviewOn}
                  onChange={(event) => setLegacy("reviewOn", event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label="Expires or renews on"
              optional
              hint="Policy maturity, lease end, domain renewal…"
              error={errors["profile.expiresOn"]}
            >
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={profile.expiresOn}
                  onChange={(event) => setLegacy("expiresOn", event.target.value)}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Nominee"
              optional
              hint="As registered with the institution"
              error={errors["profile.nomineeName"]}
            >
              {(props) => (
                <Input
                  {...props}
                  value={profile.nomineeName}
                  onChange={(event) => setLegacy("nomineeName", event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label="Nominee relationship"
              optional
              error={errors["profile.nomineeRelationship"]}
            >
              {(props) => (
                <Input
                  {...props}
                  value={profile.nomineeRelationship}
                  onChange={(event) => setLegacy("nomineeRelationship", event.target.value)}
                />
              )}
            </FormField>
          </div>
          {(beneficiaries.data?.items.length ?? 0) > 0 && (
            <FormField
              label="Nominee is one of my beneficiaries"
              optional
              error={errors["profile.nomineeBeneficiaryId"]}
            >
              {(props) => {
                const people = [
                  { value: "none", label: "Not one of my beneficiaries" },
                  ...(beneficiaries.data?.items ?? []).map((person) => ({
                    value: person.id,
                    label: person.name,
                  })),
                ];
                return (
                  <Select
                    value={profile.nomineeBeneficiaryId || "none"}
                    onValueChange={(value) => {
                      const id = value && value !== "none" ? String(value) : "";
                      setLegacy("nomineeBeneficiaryId", id);
                      const person = beneficiaries.data?.items.find((p) => p.id === id);
                      if (person && !profile.nomineeName.trim()) {
                        setLegacy("nomineeName", person.name);
                        if (!profile.nomineeRelationship.trim()) {
                          setLegacy("nomineeRelationship", person.relationship);
                        }
                      }
                    }}
                    items={people}
                  >
                    <SelectTrigger id={props.id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {people.map((person) => (
                        <SelectItem key={person.value} value={person.value}>
                          {person.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              }}
            </FormField>
          )}
          <FormField
            label="Instructions"
            optional
            hint="What should happen to it, and where its access details are kept. Never enter a password, PIN, private key or recovery phrase here."
            error={errors["profile.instructions"]}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={profile.instructions}
                onChange={(event) => setLegacy("instructions", event.target.value)}
                placeholder="e.g. Transfer to my daughter. Statements are in the blue folder; the login is in my password manager."
              />
            )}
          </FormField>
        </fieldset>
        <FormField label="Notes" optional error={errors.notes}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              value={values.notes}
              onChange={(event) => set("notes", event.target.value)}
            />
          )}
        </FormField>
      </div>
      <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Add asset"}
        </Button>
      </SheetFooter>
    </form>
  );
}
