"use client";

import { FormField } from "@/components/shared/form-field";
import { WizardStep } from "@/components/will/wizard-step";
import { useSectionForm } from "@/components/will/use-section-form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ID_TYPES = [
  { value: "PAN", label: "PAN" },
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "PASSPORT", label: "Passport" },
  { value: "NATIONAL_ID", label: "National ID" },
  { value: "OTHER", label: "Other" },
];

const defaults = {
  legalName: "",
  dateOfBirth: "",
  nationality: "",
  addressLine: "",
  city: "",
  country: "",
  idType: "" as string,
};

export function PersonalDetailsStep() {
  const { values, setField, errors, readOnly } = useSectionForm("personal-details", defaults);

  return (
    <WizardStep
      eyebrow="Step 1 · Required"
      title="Personal details"
      description="The legal identity this plan belongs to. Your display name comes from your account; the legal name here is what appears in the plan."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Full legal name"
          required
          error={errors.legalName}
          className="sm:col-span-2"
        >
          {(props) => (
            <Input
              {...props}
              value={values.legalName}
              onChange={(e) => setField("legalName", e.target.value)}
              placeholder="As it appears on your identity document"
              disabled={readOnly}
              autoComplete="name"
            />
          )}
        </FormField>
        <FormField label="Date of birth" required error={errors.dateOfBirth}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={values.dateOfBirth}
              onChange={(e) => setField("dateOfBirth", e.target.value)}
              disabled={readOnly}
            />
          )}
        </FormField>
        <FormField label="Nationality" optional error={errors.nationality}>
          {(props) => (
            <Input
              {...props}
              value={values.nationality}
              onChange={(e) => setField("nationality", e.target.value)}
              placeholder="e.g. Indian"
              disabled={readOnly}
            />
          )}
        </FormField>
        <FormField
          label="Street address"
          required
          error={errors.addressLine}
          className="sm:col-span-2"
        >
          {(props) => (
            <Input
              {...props}
              value={values.addressLine}
              onChange={(e) => setField("addressLine", e.target.value)}
              placeholder="House / flat, street, area"
              disabled={readOnly}
              autoComplete="street-address"
            />
          )}
        </FormField>
        <FormField label="City" required error={errors.city}>
          {(props) => (
            <Input
              {...props}
              value={values.city}
              onChange={(e) => setField("city", e.target.value)}
              disabled={readOnly}
              autoComplete="address-level2"
            />
          )}
        </FormField>
        <FormField label="Country" required error={errors.country}>
          {(props) => (
            <Input
              {...props}
              value={values.country}
              onChange={(e) => setField("country", e.target.value)}
              disabled={readOnly}
              autoComplete="country-name"
            />
          )}
        </FormField>
        <FormField
          label="Identity document type"
          optional
          hint="The document number itself is stored encrypted and is never shown here."
          error={errors.idType}
        >
          {(props) => (
            <Select
              value={values.idType || null}
              onValueChange={(value) => setField("idType", (value as string) ?? "")}
              items={ID_TYPES}
              disabled={readOnly}
            >
              <SelectTrigger
                id={props.id}
                aria-describedby={props["aria-describedby"]}
                className="w-full"
              >
                <SelectValue placeholder="Choose a document type" />
              </SelectTrigger>
              <SelectContent>
                {ID_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      </div>
    </WizardStep>
  );
}
