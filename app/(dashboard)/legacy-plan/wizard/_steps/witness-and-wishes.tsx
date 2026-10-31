"use client";

import { FormField } from "@/components/shared/form-field";
import { WizardStep } from "@/components/will/wizard-step";
import { useSectionForm } from "@/components/will/use-section-form";
import { Textarea } from "@/components/ui/textarea";

export function SpecialWishesStep() {
  const { values, setField, errors, readOnly } = useSectionForm("special-wishes", {
    instructions: "",
    funeralWishes: "",
    messages: "",
  });
  return (
    <WizardStep
      eyebrow="Step 4"
      title="Special wishes"
      description="Instructions your family should know, in your own words. Everything here is stored privately and released only within the scope you configure."
    >
      <div className="space-y-5">
        <FormField
          label="Instructions for my executor and family"
          error={errors.instructions}
          hint="Who to call, where things are, what matters most."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              value={values.instructions}
              onChange={(e) => setField("instructions", e.target.value)}
              disabled={readOnly}
            />
          )}
        </FormField>
        <FormField label="Funeral or memorial wishes" optional error={errors.funeralWishes}>
          {(props) => (
            <Textarea
              {...props}
              rows={3}
              value={values.funeralWishes}
              onChange={(e) => setField("funeralWishes", e.target.value)}
              disabled={readOnly}
            />
          )}
        </FormField>
        <FormField
          label="Personal messages"
          optional
          hint="Written messages for specific people. Video messages live in Video Legacy."
          error={errors.messages}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              value={values.messages}
              onChange={(e) => setField("messages", e.target.value)}
              disabled={readOnly}
            />
          )}
        </FormField>
      </div>
    </WizardStep>
  );
}
