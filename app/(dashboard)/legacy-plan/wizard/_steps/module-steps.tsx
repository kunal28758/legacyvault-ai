"use client";

import { FileText, Users } from "lucide-react";

import { StatusBadge, toneForBeneficiaryStatus } from "@/components/shared/status-badge";
import { ResourcePicker } from "@/components/will/resource-picker";
import { WizardStep } from "@/components/will/wizard-step";
import { useSectionForm } from "@/components/will/use-section-form";
import { useWizard } from "@/components/will/wizard-provider";
import { formatBytes, formatDate } from "@/lib/format";

/* Step 3 — beneficiaries (embeds the beneficiary module; stores ids — T221) */
export function BeneficiariesStep() {
  const { beneficiaries } = useWizard();
  const { values, setField, errors, readOnly } = useSectionForm("beneficiaries", {
    beneficiaryIds: [] as string[],
  });
  const items = beneficiaries
    .filter((b) => b.status !== "INACTIVE")
    .map((b) => {
      const status = toneForBeneficiaryStatus(b.status);
      return {
        id: b.id,
        title: b.name,
        subtitle: `${b.relationship} · ${b.email}`,
        icon: Users,
        meta: (
          <StatusBadge tone={status.tone} icon={null} className="h-5 text-[11px]">
            {status.label}
          </StatusBadge>
        ),
      };
    });
  return (
    <WizardStep
      eyebrow="Step 3"
      title="Beneficiaries"
      description="Choose who this plan provides for. You can add more people from the Beneficiaries page at any time; inactive beneficiaries are not listed."
    >
      <ResourcePicker
        items={items}
        selected={values.beneficiaryIds}
        onChange={(ids) => setField("beneficiaryIds", ids)}
        emptyIcon={Users}
        emptyTitle="No beneficiaries yet"
        emptyDescription="Add at least one person before continuing — they never need an account."
        addHref="/beneficiaries?new=1"
        addLabel="Add beneficiary"
        error={errors.beneficiaryIds}
        disabled={readOnly}
      />
    </WizardStep>
  );
}

/* Step 5 — document attachments (T223) */
export function DocumentAttachmentsStep() {
  const { documents } = useWizard();
  const { values, setField, errors, readOnly } = useSectionForm("document-attachments", {
    documentIds: [] as string[],
    none: false,
  });
  // Only documents that passed the upload checks are in the vault at all, and
  // every one listed here is the owner's own.
  const items = documents.map((document) => ({
    id: document.id,
    title: document.name,
    subtitle: `${formatBytes(document.sizeBytes)} · added ${formatDate(document.createdAt)}`,
    icon: FileText,
  }));
  return (
    <WizardStep
      eyebrow="Step 5"
      title="Document attachments"
      description="Attach vault documents that support the plan — the will draft, deeds, policies, identity documents. Recipients see them only within the scope you grant."
    >
      <ResourcePicker
        items={items}
        selected={values.documentIds}
        onChange={(ids) => setField("documentIds", ids)}
        none={values.none}
        onNoneChange={(none) => setField("none", none)}
        noneLabel="No documents to attach for now"
        emptyIcon={FileText}
        emptyTitle="Your vault is empty"
        emptyDescription="Upload documents to the vault first, then attach them here."
        addHref="/documents?upload=1"
        addLabel="Upload document"
        error={errors.documentIds}
        disabled={readOnly}
      />
    </WizardStep>
  );
}
