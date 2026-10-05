"use client";

import { useState } from "react";
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
import { useCreateBeneficiary, useUpdateBeneficiary } from "@/hooks/use-beneficiaries";
import { ApiError } from "@/lib/client/api-client";
import type { Beneficiary } from "@/lib/types/beneficiary";
import { RELATIONSHIPS, createBeneficiarySchema } from "@/lib/validators/beneficiary.validators";
import { fieldErrors } from "@/lib/validators/legacy-plan.validators";

interface BeneficiaryFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beneficiary?: Beneficiary | null;
}

const empty = { name: "", relationship: "", email: "", phone: "", notes: "" };

/** Add / edit beneficiary in a side sheet. Persists through the versioned API. */
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
  beneficiary: Beneficiary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateBeneficiary();
  const update = useUpdateBeneficiary();
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
  const editing = Boolean(beneficiary);
  const busy = create.isPending || update.isPending;

  const set = (field: keyof typeof empty, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  };

  /** Server-side validation is authoritative; map its field errors back onto the form. */
  const applyServerError = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code === "DUPLICATE") {
        setErrors({ email: "A beneficiary with this email already exists." });
        return;
      }
      if (error.fields) {
        const mapped: Record<string, string> = {};
        for (const [field, messages] of Object.entries(error.fields)) {
          if (messages[0]) mapped[field] = messages[0];
        }
        setErrors(mapped);
        if (Object.keys(mapped).length > 0) return;
      }
      toast.error(error.message);
      return;
    }
    toast.error("Could not save this beneficiary. Please try again.");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = createBeneficiarySchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    const payload = {
      ...parsed.data,
      phone: parsed.data.phone || null,
      notes: parsed.data.notes || null,
    };

    try {
      if (beneficiary) {
        await update.mutateAsync({ id: beneficiary.id, values: payload });
        toast.success("Beneficiary updated", {
          description: "The change is recorded in your audit log.",
        });
      } else {
        const created = await create.mutateAsync(payload);
        toast.success("Beneficiary added", {
          description: created.invitationEmailSent
            ? "We emailed them an invitation."
            : "The invitation email could not be sent. Use “Send invitation” to try again.",
        });
      }
      onOpenChange(false);
    } catch (error) {
      applyServerError(error);
    }
  };

  return (
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
              <SelectTrigger id={props.id} className="w-full" aria-invalid={props["aria-invalid"]}>
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
  );
}
