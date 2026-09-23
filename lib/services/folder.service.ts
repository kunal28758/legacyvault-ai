import "server-only";

import { ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit/audit.service";
import type { AppUser } from "@/lib/auth/ensure-app-user";
import { assertAccountActive } from "@/lib/auth/require-user";
import { createUserClient } from "@/lib/db/server";
import * as folderRepository from "@/lib/repositories/folder.repository";
import type { FolderSummary } from "@/lib/types/document";
import type { FolderCreateBody, FolderUpdateBody } from "@/lib/validators/document.validators";

/**
 * Vault folders.
 *
 * Class A throughout, with the insert policy itself requiring any parent to
 * belong to the same owner. The service additionally refuses a move that would
 * make a folder its own ancestor — the database has no cycle check, and a cycle
 * would make the tree unrenderable.
 */
export async function listFolders(user: AppUser): Promise<{ items: FolderSummary[] }> {
  const db = await createUserClient();
  const [rows, counts] = await Promise.all([
    folderRepository.list(db, user.id),
    folderRepository.documentCounts(db, user.id),
  ]);
  return {
    items: rows.map((row) => folderRepository.toFolderSummary(row, counts.get(row.id) ?? 0)),
  };
}

export async function createFolder(
  user: AppUser,
  body: FolderCreateBody,
  correlationId: string,
): Promise<FolderSummary> {
  assertAccountActive(user);
  const db = await createUserClient();

  if (body.parentId) {
    const parent = await folderRepository.findById(db, user.id, body.parentId);
    if (!parent) throw ApiError.notFound("That parent folder does not exist.");
  }

  const created = await folderRepository.insert(db, user.id, {
    name: body.name,
    parentId: body.parentId ?? null,
  });

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "folder.created",
    resourceType: "folder",
    resourceId: created.id,
    outcome: "SUCCESS",
    metadata: { parentId: created.parent_id },
    correlationId,
  });

  return folderRepository.toFolderSummary(created, 0);
}

export async function updateFolder(
  user: AppUser,
  id: string,
  body: FolderUpdateBody,
  correlationId: string,
): Promise<FolderSummary> {
  assertAccountActive(user);
  const db = await createUserClient();

  const folder = await folderRepository.findById(db, user.id, id);
  if (!folder) throw ApiError.notFound();

  const patch: { name?: string; parent_id?: string | null } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.parentId !== undefined) {
    if (body.parentId) {
      if (body.parentId === id) {
        throw ApiError.validation({ parentId: ["A folder cannot contain itself."] });
      }
      const parent = await folderRepository.findById(db, user.id, body.parentId);
      if (!parent) throw ApiError.notFound("That parent folder does not exist.");
      if (await wouldCycle(db, user.id, id, body.parentId)) {
        throw ApiError.validation({ parentId: ["That move would nest the folder inside itself."] });
      }
    }
    patch.parent_id = body.parentId;
  }

  const updated = await folderRepository.update(db, user.id, id, patch);
  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "folder.updated",
    resourceType: "folder",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { changed: Object.keys(patch) },
    correlationId,
  });

  const counts = await folderRepository.documentCounts(db, user.id);
  return folderRepository.toFolderSummary(updated, counts.get(id) ?? 0);
}

export async function deleteFolder(
  user: AppUser,
  id: string,
  correlationId: string,
): Promise<{ id: string; documentsReleased: number }> {
  assertAccountActive(user);
  const db = await createUserClient();

  const folder = await folderRepository.findById(db, user.id, id);
  if (!folder) throw ApiError.notFound();

  // Documents are never deleted with their folder; the FK sets folder_id to
  // null, so they reappear at the root rather than disappearing.
  const counts = await folderRepository.documentCounts(db, user.id);
  await folderRepository.softDelete(db, user.id, id);

  await audit.log({
    actorId: user.id,
    actorRole: user.role,
    action: "folder.deleted",
    resourceType: "folder",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { documentsReleased: counts.get(id) ?? 0 },
    correlationId,
  });

  return { id, documentsReleased: counts.get(id) ?? 0 };
}

/** Walks up from `candidateParent` looking for `folderId`. */
async function wouldCycle(
  db: Awaited<ReturnType<typeof createUserClient>>,
  userId: string,
  folderId: string,
  candidateParent: string,
): Promise<boolean> {
  let cursor: string | null = candidateParent;
  for (let depth = 0; cursor && depth < 32; depth += 1) {
    if (cursor === folderId) return true;
    const parent: { parent_id: string | null } | null = await folderRepository.findById(
      db,
      userId,
      cursor,
    );
    cursor = parent?.parent_id ?? null;
  }
  return false;
}
