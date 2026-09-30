"use client";

import { Plus, Trash2 } from "lucide-react";

import { FormField } from "@/components/shared/form-field";
import { WizardStep } from "@/components/will/wizard-step";
import { useSectionForm } from "@/components/will/use-section-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Witness = { name: string; relationship: string; email: string };

export function WitnessDetailsStep() {
  const { values, setField, errors, readOnly } = useSectionForm("witness-details", {
    witnesses: [] as Witness[],
    none: false,
  });
  const updateWitness = (index: number, patch: Partial<Witness>) =>
    setField(
      "witnesses",
      values.witnesses.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    );

  return (
    <WizardStep
      eyebrow="Step 7"
      title="Witness details"
      description="People who will witness the signed plan. Witness requirements differ by jurisdiction — record who you intend to ask; a legal professional can confirm what applies to you."
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Witnesses</p>
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              disabled={values.none || values.witnesses.length >= 6}
              onClick={() =>
                setField("witnesses", [
                  ...values.witnesses,
                  { name: "", relationship: "", email: "" },
                ])
              }
            >
              <Plus data-icon="inline-start" />
              Add witness
            </Button>
          )}
        </div>
        {values.witnesses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No witnesses added yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {values.witnesses.map((witness, index) => (
              <li
                key={index}
                className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
              >
                <FormField label="Name" required error={errors[`witnesses.${index}.name`]}>
                  {(props) => (
                    <Input
                      {...props}
                      value={witness.name}
                      onChange={(e) => updateWitness(index, { name: e.target.value })}
                      disabled={readOnly || values.none}
                    />
                  )}
                </FormField>
                <FormField label="Relationship" optional>
                  {(props) => (
                    <Input
                      {...props}
                      value={witness.relationship}
                      onChange={(e) => updateWitness(index, { relationship: e.target.value })}
                      placeholder="Friend, colleague…"
                      disabled={readOnly || values.none}
                    />
                  )}
                </FormField>
                <FormField label="Email" optional error={errors[`witnesses.${index}.email`]}>
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      value={witness.email}
                      onChange={(e) => updateWitness(index, { email: e.target.value })}
                      disabled={readOnly || values.none}
                    />
                  )}
                </FormField>
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove witness ${index + 1}`}
                    onClick={() =>
                      setField(
                        "witnesses",
                        values.witnesses.filter((_, i) => i !== index),
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
        {errors.witnesses && (
          <p role="alert" className="text-xs text-destructive">
            {errors.witnesses}
          </p>
        )}
        <Label className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3 font-normal">
          <span className="text-sm">
            I will record witnesses later (acknowledged as incomplete at finalization)
          </span>
          <Switch
            checked={values.none}
            disabled={readOnly}
            onCheckedChange={(value) => setField("none", Boolean(value))}
          />
        </Label>
      </div>
    </WizardStep>
  );
}

export function SpecialWishesStep() {
  const { values, setField, errors, readOnly } = useSectionForm("special-wishes", {
    instructions: "",
    funeralWishes: "",
    messages: "",
  });
  return (
    <WizardStep
      eyebrow="Step 8"
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
