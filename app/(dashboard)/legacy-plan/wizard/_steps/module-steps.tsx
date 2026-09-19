"use client";

import { Coins, FileText, Gem, Globe, Users } from "lucide-react";

import { StatusBadge, toneForBeneficiaryStatus } from "@/components/shared/status-badge";
import { ResourcePicker } from "@/components/wizard/resource-picker";
import { WizardStep } from "@/components/wizard/wizard-step";
import { useSectionForm } from "@/components/wizard/use-section-form";
import { useWizard } from "@/components/wizard/wizard-provider";
import { ASSET_KIND_META, allocatedPercent, assetsOfKind } from "@/lib/demo/selectors";
import type { AssetKind, PlanSectionKey } from "@/lib/demo/types";
import { formatBytes, formatCompactCurrency, titleCase } from "@/lib/format";

/* Step 3 — beneficiaries (embeds the beneficiary module; stores ids — T221) */
export function BeneficiariesStep() {
  const { workspace } = useWizard();
  const { values, setField, errors, readOnly } = useSectionForm("beneficiaries", {
    beneficiaryIds: [] as string[],
  });
  const items = workspace.beneficiaries
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

/* Steps 4–6 — asset classes (T222) */
const assetStepMeta: Record<
  AssetKind,
  {
    step: number;
    key: PlanSectionKey;
    icon: typeof Coins;
    title: string;
    description: string;
    noneLabel: string;
  }
> = {
  FINANCIAL_ASSET: {
    step: 4,
    key: "financial-assets",
    icon: Coins,
    title: "Financial assets",
    description:
      "Bank accounts, deposits, funds, insurance and retirement accounts to include in the plan. Account and policy numbers stay encrypted.",
    noneLabel: "I have no financial assets to include",
  },
  PHYSICAL_ASSET: {
    step: 5,
    key: "physical-assets",
    icon: Gem,
    title: "Physical assets",
    description:
      "Property, vehicles, jewellery and other valuables. Attach deeds or valuations from the vault later in step 9.",
    noneLabel: "I have no physical assets to include",
  },
  DIGITAL_ASSET: {
    step: 6,
    key: "digital-assets",
    icon: Globe,
    title: "Digital assets",
    description:
      "Online accounts, domains, wallets and subscriptions. Credentials and recovery information are never shown in the plan.",
    noneLabel: "I have no digital assets to include",
  },
};

export function AssetsStep({ kind }: { kind: AssetKind }) {
  const meta = assetStepMeta[kind];
  const { workspace } = useWizard();
  const { values, setField, errors, readOnly } = useSectionForm(meta.key, {
    assetIds: [] as string[],
    none: false,
  });
  const assets = assetsOfKind(workspace, kind);
  const items = assets.map((asset) => {
    const allocated = allocatedPercent(workspace, kind, asset.id);
    return {
      id: asset.id,
      title: asset.name,
      subtitle: `${titleCase(asset.category)}${"institution" in asset && asset.institution ? ` · ${asset.institution}` : "platform" in asset && asset.platform ? ` · ${asset.platform}` : ""}`,
      icon: meta.icon,
      meta: (
        <span className="text-right">
          <span className="block font-medium text-foreground">
            {formatCompactCurrency(asset.estimatedValue, asset.currency)}
          </span>
          <span className="block">{allocated}% allocated</span>
        </span>
      ),
    };
  });
  return (
    <WizardStep eyebrow={`Step ${meta.step}`} title={meta.title} description={meta.description}>
      <ResourcePicker
        items={items}
        selected={values.assetIds}
        onChange={(ids) => setField("assetIds", ids)}
        none={values.none}
        onNoneChange={(none) => setField("none", none)}
        noneLabel={meta.noneLabel}
        emptyIcon={meta.icon}
        emptyTitle={`No ${ASSET_KIND_META[kind].plural.toLowerCase()} recorded`}
        emptyDescription="Record them from the Assets section, or mark this class as none for now."
        addHref={ASSET_KIND_META[kind].href}
        addLabel="Add asset"
        error={errors.assetIds}
        disabled={readOnly}
      />
    </WizardStep>
  );
}

/* Step 9 — document attachments (T223) */
export function DocumentAttachmentsStep() {
  const { workspace } = useWizard();
  const { values, setField, errors, readOnly } = useSectionForm("document-attachments", {
    documentIds: [] as string[],
    none: false,
  });
  const items = workspace.documents.map((doc) => ({
    id: doc.id,
    title: doc.name,
    subtitle: `${workspace.folders.find((f) => f.id === doc.folderId)?.name ?? "Root"} · ${formatBytes(doc.sizeBytes)} · v${doc.versionCount}`,
    icon: FileText,
    meta: doc.scanStatus === "CLEAN" ? "Scanned" : "Scanning",
  }));
  return (
    <WizardStep
      eyebrow="Step 9"
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
