import "server-only";

import { getAIProvider } from "@/lib/ai";
import { ASSISTANT_ATTACHMENT_RULES, ASSISTANT_SYSTEM, PROMPT_VERSIONS } from "@/lib/ai/prompts";
import type { AIContentPart, AIStream, AIUsage } from "@/lib/ai/provider";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createServiceClient, createUserClient, type TypedSupabaseClient } from "@/lib/db/server";
import { computeCompleteness } from "@/lib/legacy-plan/completeness";
import { logger } from "@/lib/observability/logger";
import * as aiRepository from "@/lib/repositories/ai.repository";
import * as assetRepository from "@/lib/repositories/asset.repository";
import * as dmsRepository from "@/lib/repositories/dms.repository";
import * as planRepository from "@/lib/repositories/legacy-plan.repository";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import type { AIInteractionSummary } from "@/lib/types/ai";
import type { AssistantMessageBody } from "@/lib/validators/ai.validators";

import { loadAssistantAttachments } from "./document-ai.service";
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

/**
 * The route's rate-limit hit pays for the message and its first attachment;
 * each further attachment is one more document operation on the same `ai`
 * budget, so attaching files can never multiply the work a single hit buys.
 */
async function chargeExtraAttachments(user: AppUser, count: number): Promise<void> {
  for (let extra = 1; extra < count; extra++) {
    await enforceRateLimit({ policy: "ai", subject: user.id });
  }
}

export async function streamAssistantReply(
  user: AppUser,
  body: AssistantMessageBody,
  correlationId: string,
  signal?: AbortSignal,
): Promise<{ stream: AIStream; onComplete: (usage: AIUsage) => Promise<void> }> {
  assertAccountActive(user);
  try {
    await chargeExtraAttachments(user, body.attachmentIds.length);

    const db = await createUserClient();
    const overview = await buildAccountOverview(db, user).catch((cause: unknown) => {
      // Answers are still useful without personalisation.
      logger.warn({ err: cause }, "assistant account overview unavailable");
      return "Account overview: unavailable right now.";
    });

    // Ownership and type are checked again here for every id.
    const attachments = await loadAssistantAttachments(user, body.attachmentIds, signal);
    const hasAttachments = attachments.documentIds.length > 0;
    const question: string | AIContentPart[] = hasAttachments
      ? [
          ...attachments.parts,
          {
            kind: "text",
            text: `The user's message about the attachments above:\n${body.message}`,
          },
        ]
      : body.message;

    const provider = getAIProvider();
    const stream = await provider.stream({
      system: hasAttachments
        ? `${ASSISTANT_SYSTEM}\n${ASSISTANT_ATTACHMENT_RULES}\n\n${overview}`
        : `${ASSISTANT_SYSTEM}\n\n${overview}`,
      messages: [
        ...body.history.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: question },
      ],
      // Summaries of a whole document need more room than a chat answer.
      maxOutputTokens: hasAttachments ? 3_000 : 1_500,
      // Vault content may only go to providers approved for it.
      containsDocuments: hasAttachments,
      signal,
    });

    for (const documentId of attachments.documentIds) {
      await audit.log({
        actorId: user.id,
        actorRole: user.role,
        action: "ai.assistant_attachment_read",
        resourceType: "document",
        resourceId: documentId,
        outcome: "SUCCESS",
        metadata: { provider: stream.provider },
        correlationId,
      });
    }

    return {
      stream,
      onComplete: async (usage) => {
        try {
          await aiRepository.insertInteraction(createServiceClient(), {
            userId: user.id,
            sessionType: "ASSISTANT",
            provider: stream.provider,
            model: stream.model,
            promptVersion: hasAttachments
              ? PROMPT_VERSIONS.assistantAttachments
              : PROMPT_VERSIONS.assistant,
            // How each file was read, never its name or content.
            inputSummary:
              `message · ${body.history.length} prior turns` +
              (hasAttachments
                ? ` · ${attachments.documentIds.length} attachments (${attachments.methods.join(", ")})${attachments.truncated ? " · truncated" : ""}`
                : ""),
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
