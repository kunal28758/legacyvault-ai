"use client";

import { Plus, Trash2 } from "lucide-react";

import { FormField } from "@/components/forms/form-field";
import { WizardStep } from "@/components/wizard/wizard-step";
import { useSectionForm } from "@/components/wizard/use-section-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

const STATUSES = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married" },
  { value: "partnered", label: "Partnered" },
  { value: "divorced", label: "Divorced" },
  { value: "widowed", label: "Widowed" },
];

type Child = { name: string; dateOfBirth: string };

const defaults = {
  maritalStatus: "" as string,
  spouseName: "",
  children: [] as Child[],
  dependents: "",
};

export function FamilyInformationStep() {
  const { values, setField, errors, readOnly } = useSectionForm("family-information", defaults);

  const updateChild = (index: number, patch: Partial<Child>) =>
    setField(
      "children",
      values.children.map((child, i) => (i === index ? { ...child, ...patch } : child)),
    );

  return (
    <WizardStep
      eyebrow="Step 2"
      title="Family information"
      description="Who depends on you and who should be considered when your legacy is distributed. This is informational — beneficiaries are selected in the next step."
    >
      <div className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">
            Marital status <span className="text-destructive">*</span>
          </legend>
          <RadioGroup
            value={values.maritalStatus || null}
            onValueChange={(value) => setField("maritalStatus", String(value ?? ""))}
            disabled={readOnly}
            aria-invalid={errors.maritalStatus ? true : undefined}
            className="flex flex-wrap gap-2"
          >
            {STATUSES.map((status) => (
              <Label
                key={status.value}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-2 font-normal has-data-checked:border-primary/60 has-data-checked:bg-primary/10"
              >
                <RadioGroupItem value={status.value} />
                {status.label}
              </Label>
            ))}
          </RadioGroup>
          {errors.maritalStatus && (
            <p role="alert" className="text-xs text-destructive">
              {errors.maritalStatus}
            </p>
          )}
        </fieldset>

        {(values.maritalStatus === "married" || values.maritalStatus === "partnered") && (
          <FormField label="Spouse / partner name" optional error={errors.spouseName}>
            {(props) => (
              <Input
                {...props}
                value={values.spouseName}
                onChange={(e) => setField("spouseName", e.target.value)}
                disabled={readOnly}
              />
            )}
          </FormField>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Children</p>
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setField("children", [...values.children, { name: "", dateOfBirth: "" }])
                }
                disabled={values.children.length >= 20}
              >
                <Plus data-icon="inline-start" />
                Add child
              </Button>
            )}
          </div>
          {values.children.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No children added. Add them here so the plan can reference them later.
            </p>
          ) : (
            <ul className="space-y-3">
              {values.children.map((child, index) => (
                <li
                  key={index}
                  className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
                >
                  <FormField
                    label={`Child ${index + 1} name`}
                    required
                    error={errors[`children.${index}.name`]}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={child.name}
                        onChange={(e) => updateChild(index, { name: e.target.value })}
                        disabled={readOnly}
                      />
                    )}
                  </FormField>
                  <FormField
                    label="Date of birth"
                    optional
                    error={errors[`children.${index}.dateOfBirth`]}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="date"
                        value={child.dateOfBirth}
                        onChange={(e) => updateChild(index, { dateOfBirth: e.target.value })}
                        disabled={readOnly}
                        className="sm:w-44"
                      />
                    )}
                  </FormField>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove child ${index + 1}`}
                      onClick={() =>
                        setField(
                          "children",
                          values.children.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <FormField
          label="Other dependents"
          optional
          hint="Parents, relatives or anyone else who relies on you."
          error={errors.dependents}
        >
          {(props) => (
            <Textarea
              {...props}
              value={values.dependents}
              onChange={(e) => setField("dependents", e.target.value)}
              rows={3}
              disabled={readOnly}
            />
          )}
        </FormField>
      </div>
    </WizardStep>
  );
}
