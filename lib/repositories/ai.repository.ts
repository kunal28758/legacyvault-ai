import "server-only";

import type { TypedSupabaseClient } from "@/lib/db/server";
import type { Database, Json } from "@/lib/types/database";

/**
 * AI persistence (ADR-016).
 *
 *  • `ai_interactions` — the sanitized usage/audit record of every model call:
 *    provider, model, prompt version, token counts and a content-free summary.
 *  • `ai_drafts` / `ai_draft_versions` — stored document analyses. Each
 *    document has one DOCUMENT_ANALYSIS draft; every generated result is an
 *    immutable version whose `content` is an application-encrypted envelope.
 *
 * All three are SELECT-own for `authenticated`; writes go through the service
 * client from the AI services, which have already proven ownership of the
 * document (ADR-016 § 3). Chat turns are never written anywhere.
 */
export type InteractionRow = Database["public"]["Tables"]["ai_interactions"]["Row"];
export type DraftVersionRow = Database["public"]["Tables"]["ai_draft_versions"]["Row"];
export type SessionType = Database["public"]["Enums"]["ai_session_type"];

export interface InteractionInsert {
  userId: string;
  sessionType: SessionType;
  provider: string;
  model: string | null;
  promptVersion: string;
  draftId?: string | null;
  inputSummary: string;
  outputSummary: string;
  validation?: Json | null;
  tokenCount?: number | null;
}

export async function insertInteraction(
  serviceDb: TypedSupabaseClient,
  input: InteractionInsert,
): Promise<string> {
  const { data, error } = await serviceDb
    .from("ai_interactions")
    .insert({
      user_id: input.userId,
      session_type: input.sessionType,
      provider: input.provider,
      model: input.model,
      prompt_version: input.promptVersion,
      draft_id: input.draftId ?? null,
      input_summary: input.inputSummary.slice(0, 500),
      output_summary: input.outputSummary.slice(0, 500),
      validation: input.validation ?? null,
      token_count: input.tokenCount ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function listInteractions(
  db: TypedSupabaseClient,
  userId: string,
  limit: number,
): Promise<InteractionRow[]> {
  const { data, error } = await db
    .from("ai_interactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function countInteractionsSince(
  db: TypedSupabaseClient,
  userId: string,
  since: string,
): Promise<number> {
  const { count, error } = await db
    .from("ai_interactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}

/** The document's analysis draft, read through RLS as the owner. */
export async function findAnalysisDraftId(
  db: TypedSupabaseClient,
  userId: string,
  documentId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("ai_drafts")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "DOCUMENT_ANALYSIS")
    .eq("source_document_id", documentId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function createAnalysisDraft(
  serviceDb: TypedSupabaseClient,
  userId: string,
  documentId: string,
): Promise<string> {
  const { data, error } = await serviceDb
    .from("ai_drafts")
    .insert({ user_id: userId, kind: "DOCUMENT_ANALYSIS", source_document_id: documentId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export interface VersionInsert {
  draftId: string;
  content: Json;
  provider: string;
  model: string;
  promptVersion: string;
  interactionId: string | null;
  sectionConfidence?: Json | null;
}

/**
 * Appends an immutable AI version and points the draft at it. The version
 * number is `max + 1`; a concurrent writer that takes the same number hits the
 * unique constraint and this retries once with the next one.
 */
export async function appendVersion(
  serviceDb: TypedSupabaseClient,
  input: VersionInsert,
): Promise<DraftVersionRow> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: latest, error: latestError } = await serviceDb
      .from("ai_draft_versions")
      .select("version_number")
      .eq("draft_id", input.draftId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    const { data, error } = await serviceDb
      .from("ai_draft_versions")
      .insert({
        draft_id: input.draftId,
        version_number: (latest?.version_number ?? 0) + 1,
        created_by: "AI",
        content: input.content,
        provider: input.provider,
        model: input.model,
        prompt_version: input.promptVersion,
        interaction_id: input.interactionId,
        section_confidence: input.sectionConfidence ?? null,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505" && attempt === 0) continue;
      throw error;
    }

    const { error: pointerError } = await serviceDb
      .from("ai_drafts")
      .update({ current_version_id: data.id })
      .eq("id", input.draftId);
    if (pointerError) throw pointerError;
    return data;
  }
  throw new Error("could not allocate an AI draft version number");
}

/** Newest first, read through RLS as the owner. */
export async function listVersions(
  db: TypedSupabaseClient,
  draftId: string,
  limit: number,
): Promise<DraftVersionRow[]> {
  const { data, error } = await db
    .from("ai_draft_versions")
    .select("*")
    .eq("draft_id", draftId)
    .order("version_number", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
