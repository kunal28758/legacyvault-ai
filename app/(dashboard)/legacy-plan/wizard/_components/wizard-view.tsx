"use client";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/loading-skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { Stepper } from "@/components/will/stepper";
import { WizardProvider, useWizard } from "@/components/will/wizard-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PLAN_STEPS } from "@/lib/legacy-plan/steps";

import { FamilyInformationStep } from "../_steps/family-information";
import { BeneficiariesStep, DocumentAttachmentsStep } from "../_steps/module-steps";
import { PersonalDetailsStep } from "../_steps/personal-details";
import { ConfirmationStep, ReviewStep } from "../_steps/review-and-confirmation";
import { SpecialWishesStep } from "../_steps/witness-and-wishes";

function CurrentStep() {
  const { currentStep } = useWizard();
  switch (currentStep) {
    case 1:
      return <PersonalDetailsStep key="1" />;
    case 2:
      return <FamilyInformationStep key="2" />;
    case 3:
      return <BeneficiariesStep key="3" />;
    case 4:
      return <SpecialWishesStep key="4" />;
    case 5:
      return <DocumentAttachmentsStep key="5" />;
    case 6:
      return <ReviewStep key="6" />;
    default:
      return <ConfirmationStep key="7" />;
  }
}

function WizardBody() {
  const { plan, currentStep, percent, completeness, goTo, readOnly } = useWizard();
  const steps = PLAN_STEPS.map((step) => ({
    step: step.step,
    title: step.title,
    description: step.description,
    complete:
      step.key === "review"
        ? plan.status === "FINALIZED"
        : step.key === "confirmation"
          ? plan.status === "FINALIZED"
          : completeness.sections[step.key].complete,
    skipped:
      step.key !== "review" && step.key !== "confirmation"
        ? completeness.sections[step.key].skipped === true
        : false,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Digital will"
        title={
          plan.status === "FINALIZED"
            ? `Legacy plan v${plan.version}`
            : `Create your will · draft v${plan.version}`
        }
        description="A guided, auto-saving plan. Move freely between completed steps; nothing becomes authoritative until you finalize."
        actions={
          <>
            <StatusBadge tone={readOnly ? "success" : "info"} icon={readOnly ? Lock : undefined}>
              {readOnly ? "Finalized · read-only" : "Draft"}
            </StatusBadge>
            <Button variant="ghost" nativeButton={false} render={<Link href="/legacy-plan" />}>
              <ArrowLeft data-icon="inline-start" />
              Plan overview
            </Button>
          </>
        }
      />
      <Card className="glass-highlight glass">
        <CardContent className="p-5 sm:p-6">
          <Stepper
            steps={steps}
            current={currentStep}
            percent={percent}
            onSelect={goTo}
            locked={false}
          />
        </CardContent>
      </Card>
      <Card className="glass-strong">
        <CardContent className="p-5 sm:p-8">
          <CurrentStep />
        </CardContent>
      </Card>
    </div>
  );
}

export function WizardView() {
  return (
    <Suspense fallback={<PageSkeleton stats={0} />}>
      <WizardProvider fallback={<PageSkeleton stats={0} />}>
        <WizardBody />
      </WizardProvider>
    </Suspense>
  );
}
