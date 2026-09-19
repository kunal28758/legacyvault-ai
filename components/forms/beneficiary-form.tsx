"use client";

import { useState } from "react";
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
import type { DemoBeneficiary } from "@/lib/demo/types";
import { RELATIONSHIPS, createBeneficiarySchema } from "@/lib/validators/beneficiary.validators";
import { fieldErrors } from "@/lib/validators/legacy-plan.validators";

interface BeneficiaryFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beneficiary?: DemoBeneficiary | null;
}

const empty = { name: "", relationship: "", email: "", phone: "", notes: "" };

/** Add / edit beneficiary in a side sheet with Zod validation and duplicate-email handling. */
export function BeneficiaryFormSheet({
  open,
  onOpenChange,
  beneficiary,
}: BeneficiaryFormSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto glass-strong sm:max-w-md">
        <BeneficiaryForm beneficiary={beneficiary ?? null} onOpenChange={onOpenChange} />
      </SheetContent>
    </Sheet>
  );
}

/** Mounted fresh every time the sheet opens, so state initialises from props without effects. */
function BeneficiaryForm({
  beneficiary,
  onOpenChange,
}: {
  beneficiary: DemoBeneficiary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const addBeneficiary = useDemoStore((s) => s.addBeneficiary);
  const updateBeneficiary = useDemoStore((s) => s.updateBeneficiary);
  const [values, setValues] = useState(() =>
    beneficiary
      ? {
          name: beneficiary.name,
          relationship: beneficiary.relationship,
          email: beneficiary.email,
          phone: beneficiary.phone ?? "",
          notes: beneficiary.notes ?? "",
        }
      : empty,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editing = Boolean(beneficiary);

  const set = (field: keyof typeof empty, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = createBeneficiarySchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setBusy(true);
    const payload = {
      ...parsed.data,
      phone: parsed.data.phone || null,
      notes: parsed.data.notes || null,
    };
    const result = beneficiary
      ? updateBeneficiary(beneficiary.id, payload)
      : addBeneficiary(payload);
    setBusy(false);
    if (!result.ok) {
      if (result.code === "DUPLICATE_EMAIL")
        setErrors({ email: result.message ?? "Duplicate email" });
      else toast.error(result.message);
      return;
    }
    toast.success(beneficiary ? "Beneficiary updated" : "Beneficiary added", {
      description: beneficiary ? undefined : "An invitation email is sent in the live application.",
    });
    onOpenChange(false);
  };

  return (
    <>
      <form onSubmit={submit} className="flex h-full flex-col gap-6">
        <SheetHeader className="pr-10">
          <SheetTitle>{editing ? "Edit beneficiary" : "Add beneficiary"}</SheetTitle>
          <SheetDescription>
            {editing
              ? "Changing the name or email is an authoritative change and is recorded in your audit log."
              : "Beneficiaries receive scoped, time-limited access links — they never need an account."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 px-4">
          <FormField label="Full name" required error={errors.name}>
            {(props) => (
              <Input
                {...props}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                autoComplete="off"
              />
            )}
          </FormField>
          <FormField label="Relationship" required error={errors.relationship}>
            {(props) => (
              <Select
                value={values.relationship || null}
                onValueChange={(value) => set("relationship", String(value ?? ""))}
                items={RELATIONSHIPS.map((r) => ({ value: r, label: r }))}
              >
                <SelectTrigger
                  id={props.id}
                  className="w-full"
                  aria-invalid={props["aria-invalid"]}
                >
                  <SelectValue placeholder="Choose a relationship" />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField
            label="Email"
            required
            error={errors.email}
            hint="Access links and one-time codes are sent here."
          >
            {(props) => (
              <Input
                {...props}
                type="email"
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
                autoComplete="off"
              />
            )}
          </FormField>
          <FormField label="Phone" optional error={errors.phone}>
            {(props) => (
              <Input
                {...props}
                type="tel"
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Notes" optional error={errors.notes}>
            {(props) => (
              <Textarea
                {...props}
                rows={3}
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
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add beneficiary"}
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}
