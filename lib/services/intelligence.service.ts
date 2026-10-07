import "server-only";

import type { AppUser } from "@/lib/auth/ensure-app-user";
import {
  analyzeLegacy,
  FINDING_TYPE_LABELS,
  FINDING_TYPES,
  RULES,
  type LegacyIntelligence,
  type RuleId,
} from "@/lib/client/intelligence";
import { WILL } from "@/lib/client/legacy-graph";
import { buildLegacySnapshot, type LegacySnapshotInput } from "@/lib/client/legacy-snapshot";
import * as assetService from "@/lib/services/asset.service";
import * as beneficiaryService from "@/lib/services/beneficiary.service";
import * as dmsService from "@/lib/services/dms.service";
import * as documentService from "@/lib/services/document.service";
import * as emergencyAccessService from "@/lib/services/emergency-access.service";
import * as planService from "@/lib/services/legacy-plan.service";
import * as userService from "@/lib/services/user.service";
import { assetListQuerySchema } from "@/lib/validators/asset.validators";
import { beneficiaryListQuerySchema } from "@/lib/validators/beneficiary.validators";
import { documentListQuerySchema } from "@/lib/validators/document.validators";

/**
 * Legacy Intelligence on the server — the same deterministic engine the
 * browser runs, over the same owner-scoped service reads (RLS + owner filters),
 * so the Copilot and the UI can never disagree. Used only to ground the
 * Copilot; nothing here writes.
 */
export async function loadLegacyIntelligence(user: AppUser): Promise<LegacyIntelligence> {
  const page = { limit: 100 };
  const [me, plan, beneficiaries, financial, physical, digital, documents, dms, emergency] =
    await Promise.all([
      userService.getMe(user),
      planService.getOverview(user),
      // The browser's default page, so both evaluate exactly the same records.
      beneficiaryService.listBeneficiaries(user, beneficiaryListQuerySchema.parse({})),
      assetService.listAssets(user, "FINANCIAL_ASSET", assetListQuerySchema.parse(page)),
      assetService.listAssets(user, "PHYSICAL_ASSET", assetListQuerySchema.parse(page)),
      assetService.listAssets(user, "DIGITAL_ASSET", assetListQuerySchema.parse(page)),
      documentService.listDocuments(user, documentListQuerySchema.parse(page)),
      dmsService.getSwitch(user),
      emergencyAccessService.getOverview(user),
    ]);

  const input: LegacySnapshotInput = {
    now: Date.now(),
    profile: {
      mfaEnabled: me.mfaEnabled,
      emailVerified: me.emailVerified,
      alternateEmail: me.alternateEmail,
      preferences: (me.preferences ?? {}) as Record<string, unknown>,
    },
    planOverview: plan,
    beneficiaries: beneficiaries.items,
    beneficiaryTotal: beneficiaries.total,
    assets: [...financial.items, ...physical.items, ...digital.items],
    assetTotal: financial.total + physical.total + digital.total,
    documents: documents.items,
    documentTotal: documents.total,
    dms,
    emergency,
  };
  return analyzeLegacy(input, buildLegacySnapshot(input));
}

/**
 * The Copilot's view of the findings: counts per kind and per rule, plus
 * coverage. No record or people names — the same data-minimisation line as the
 * account overview, so no vault content reaches a model provider. The names
 * live on the Legacy Intelligence page, which the Copilot points to.
 */
export function describeForAssistant(intelligence: LegacyIntelligence): string {
  const { open, coverage, graph } = intelligence;
  const byRule = new Map<RuleId, number>();
  for (const finding of open) byRule.set(finding.ruleId, (byRule.get(finding.ruleId) ?? 0) + 1);
  const willAssets = graph
    .in(WILL, "referenced_by")
    .filter((edge) => edge.from.startsWith("asset:"));

  const lines = [
    "System-detected findings (LegacyVault's deterministic rules over the user's own records — facts, not AI output, not legal advice; counts only, no names):",
    `- Open findings: ${open.length}` +
      (open.length
        ? ` (${FINDING_TYPES.map(
            (type) => [type, open.filter((f) => f.type === type).length] as const,
          )
            .filter(([, count]) => count > 0)
            .map(([type, count]) => `${count} ${FINDING_TYPE_LABELS[type].toLowerCase()}`)
            .join(", ")})`
        : ""),
    ...[...byRule].map(([ruleId, count]) => `- ${ruleId} (${RULES[ruleId].name}): ${count}`),
    `- Assets still held: ${coverage.heldAssets}; with a beneficiary: ${coverage.assignedAssets}` +
      (coverage.documentsComplete
        ? `; financial/physical assets with a supporting document: ${coverage.supportedAssets} of ${coverage.documentableAssets}`
        : ""),
    `- Assets referenced in the Will: ${willAssets.length}`,
  ];
  return lines.join("\n");
}
