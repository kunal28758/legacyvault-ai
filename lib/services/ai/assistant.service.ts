import "server-only";

import { getAIProvider } from "@/lib/ai";
import { ASSISTANT_SYSTEM, PROMPT_VERSIONS } from "@/lib/ai/prompts";
import type { AIStream, AIUsage } from "@/lib/ai/provider";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createServiceClient, createUserClient, type TypedSupabaseClient } from "@/lib/db/server";
import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import { logger } from "@/lib/observability/logger";
import * as aiRepository from "@/lib/repositories/ai.repository";
import * as assetRepository from "@/lib/repositories/asset.repository";
import * as dmsRepository from "@/lib/repositories/dms.repository";
import * as planRepository from "@/lib/repositories/legacy-plan.repository";
import type { AIInteractionSummary } from "@/lib/types/ai";
import type { AssistantMessageBody } from "@/lib/validators/ai.validators";

import { toAIApiError } from "./errors";

/**
 * The AI assistant (ADR-008, ADR-016 § 2, api-contracts.md § AI).
 *
 * Conversation turns are session-scoped and client-held: the browser sends up
 * to 20 prior turns with each message, and the server stores neither the
 * message nor the reply — only a sanitized usage row.
 *
 * To personalise answers the model receives an *account overview* built here
 * from the caller's own rows: counts, completeness and gaps. No names, no
 * values, no document content, no secrets — data minimisation is the design,
 * not an afterthought.
 */
async function count(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count: value, error } = await query;
  if (error) throw error;
  return value ?? 0;
}

export async function buildAccountOverview(
  db: TypedSupabaseClient,
  user: AppUser,
): Promise<string> {
  const head = { count: "exact" as const, head: true };
  const [
    beneficiaries,
    financialIds,
    physicalIds,
    digitalIds,
    assignedRows,
    documents,
    videos,
    draft,
    latest,
    dms,
    emergencyContacts,
  ] = await Promise.all([
    db.from("beneficiaries").select("id, status").eq("user_id", user.id).is("deleted_at", null),
    assetRepository.listIds(db, user.id, "FINANCIAL_ASSET"),
    assetRepository.listIds(db, user.id, "PHYSICAL_ASSET"),
    assetRepository.listIds(db, user.id, "DIGITAL_ASSET"),
    db.from("beneficiary_assignments").select("resource_id").eq("user_id", user.id),
    count(db.from("documents").select("id", head).eq("user_id", user.id).is("deleted_at", null)),
    count(
      db.from("video_messages").select("id", head).eq("user_id", user.id).is("deleted_at", null),
    ),
    planRepository.findDraft(db, user.id),
    planRepository.findLatest(db, user.id),
    dmsRepository.findForUser(db, user.id),
    count(
      db
        .from("emergency_access_configs")
        .select("id", head)
        .eq("user_id", user.id)
        .is("deleted_at", null),
    ),
  ]);
  if (beneficiaries.error) throw beneficiaries.error;
  if (assignedRows.error) throw assignedRows.error;

  const beneficiaryRows = beneficiaries.data ?? [];
  const assigned = new Set((assignedRows.data ?? []).map((row) => row.resource_id));
  const allAssetIds = [...financialIds, ...physicalIds, ...digitalIds];
  const unassigned = allAssetIds.filter((id) => !assigned.has(id)).length;

  const plan = draft ?? latest;
  const completeness = plan
    ? computeCompleteness({
        stepsData: plan.stepsData,
        beneficiaries: beneficiaryRows,
        assets: [
          ...financialIds.map((id) => ({ id, kind: "FINANCIAL_ASSET" as const })),
          ...physicalIds.map((id) => ({ id, kind: "PHYSICAL_ASSET" as const })),
          ...digitalIds.map((id) => ({ id, kind: "DIGITAL_ASSET" as const })),
        ],
        documents: [],
      })
    : null;

  const lines = [
    "Account overview (counts only, from the user's own LegacyVault account):",
    plan
      ? `- Legacy plan: ${plan.status === "FINALIZED" ? `finalized (version ${plan.version})` : "draft in progress"}; ${completeness?.percent ?? 0}% of sections complete` +
        (completeness && completeness.incompleteSections.length
          ? `; incomplete: ${completeness.incompleteSections.map((key) => completeness.sections[key].title).join(", ")}`
          : "")
      : "- Legacy plan: not started",
    `- Beneficiaries: ${beneficiaryRows.length} (${beneficiaryRows.filter((b) => b.status === "ACTIVE").length} active, ${beneficiaryRows.filter((b) => b.status === "PENDING").length} pending)`,
    `- Assets: ${financialIds.length} financial, ${physicalIds.length} physical, ${digitalIds.length} digital; ${unassigned} with no beneficiary assigned`,
    `- Documents in the vault: ${documents}; video messages: ${videos}`,
    `- Dead Man's Switch: ${dms ? `${dms.status.toLowerCase()}, check-in every ${dms.check_in_frequency_days} days` : "not configured"}`,
    `- Emergency access contacts: ${emergencyContacts}`,
    `- Two-factor authentication: ${user.mfaEnabled ? "on" : "off"}`,
  ];
  return lines.join("\n");
}

export async function streamAssistantReply(
  user: AppUser,
  body: AssistantMessageBody,
  signal?: AbortSignal,
): Promise<{ stream: AIStream; onComplete: (usage: AIUsage) => Promise<void> }> {
  assertAccountActive(user);
  try {
    const db = await createUserClient();
    const overview = await buildAccountOverview(db, user).catch((cause: unknown) => {
      // Answers are still useful without personalisation.
      logger.warn({ err: cause }, "assistant account overview unavailable");
      return "Account overview: unavailable right now.";
    });

    const provider = getAIProvider();
    const stream = await provider.stream({
      system: `${ASSISTANT_SYSTEM}\n\n${overview}`,
      messages: [
        ...body.history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: body.message },
      ],
      maxOutputTokens: 1_500,
      signal,
    });

    return {
      stream,
      onComplete: async (usage) => {
        try {
          await aiRepository.insertInteraction(createServiceClient(), {
            userId: user.id,
            sessionType: "ASSISTANT",
            provider: stream.provider,
            model: stream.model,
            promptVersion: PROMPT_VERSIONS.assistant,
            inputSummary: `message · ${body.history.length} prior turns`,
            outputSummary: "reply streamed",
            tokenCount:
              usage.inputTokens === null && usage.outputTokens === null
                ? null
                : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          });
        } catch (cause) {
          logger.error({ err: cause }, "failed to record AI interaction");
        }
      },
    };
  } catch (error) {
    throw toAIApiError(error);
  }
}

/** The caller's sanitized usage records — never content (api-contracts.md § AI). */
export async function listInteractions(
  user: AppUser,
  limit = 20,
): Promise<{ items: AIInteractionSummary[] }> {
  const db = await createUserClient();
  const rows = await aiRepository.listInteractions(db, user.id, Math.min(Math.max(limit, 1), 50));
  return {
    items: rows.map((row) => ({
      id: row.id,
      sessionType: row.session_type,
      provider: row.provider,
      model: row.model,
      summary: row.output_summary,
      createdAt: row.created_at,
    })),
  };
}
