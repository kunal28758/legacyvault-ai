import "server-only";

import { createHash } from "node:crypto";

import { getPublicEnv } from "@/lib/config/public-env";

/**
 * Log-safe, primitive copies of a failure's identifying fields.
 *
 * A Supabase gateway refusal (for example "Invalid API key") reaches the app as
 * a plain object with an empty stack, and log viewers that collapse nested
 * objects have shown the whole `err` as `{}`. These flat fields always render.
 * Nothing here is new information — the same values are inside `err` — except
 * that `details` is deliberately not copied: for database errors it can quote
 * row values.
 */
export function errorFields(error: unknown): Record<string, string> {
  if (error === null || typeof error !== "object") return { errorMessage: String(error) };
  const record = error as Record<string, unknown>;
  const fields: Record<string, string> = {};

  const constructorName = (error as { constructor?: { name?: string } }).constructor?.name;
  const name = typeof record.name === "string" ? record.name : constructorName;
  if (name) fields.errorName = name;
  for (const [key, field] of [
    ["code", "errorCode"],
    ["message", "errorMessage"],
    ["hint", "errorHint"],
  ] as const) {
    const value = record[key];
    if (typeof value === "string" && value) fields[field] = value.slice(0, 300);
    else if (typeof value === "number") fields[field] = String(value);
  }
  return fields;
}

/**
 * Which Supabase project and publishable key the user-scoped client was built
 * with. `NEXT_PUBLIC_*` values are frozen into the server bundle at build time,
 * so this is what the running deployment actually uses — not what the hosting
 * dashboard currently shows. The key itself is never logged: only its kind, a
 * short SHA-256 fingerprint and whether it contains stray quotes or whitespace.
 */
export function supabaseClientFields(): Record<string, string> {
  try {
    const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key } =
      getPublicEnv();
    return {
      supabaseHost: new URL(url).host,
      supabaseKeyKind: key.startsWith("sb_publishable_")
        ? "publishable"
        : key.split(".").length === 3
          ? "legacy-jwt"
          : "unrecognised",
      supabaseKeyFingerprint: createHash("sha256").update(key).digest("hex").slice(0, 12),
      supabaseKeyClean: /^[A-Za-z0-9._-]+$/.test(key) ? "yes" : "no",
    };
  } catch {
    return { supabaseHost: "public-env-invalid" };
  }
}
