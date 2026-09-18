import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Mints HS256 JWTs shaped like the Clerk session tokens Supabase receives through its
 * third-party-auth integration (ADR-004 r2 § 7). RLS policies only read claims —
 * `sub` (= users.clerk_user_id) and `role` — so a token signed with the LOCAL stack's
 * JWT secret is enough for policy tests against `supabase start`.
 *
 * The secret comes from `SUPABASE_JWT_SECRET` (printed by `supabase status`); the
 * documented local default is used as a fallback. Never point this at a hosted project.
 */
export const LOCAL_SUPABASE_JWT_SECRET_FALLBACK =
  "super-secret-jwt-token-with-at-least-32-characters-long";

export interface ClerkShapedClaims {
  /** Clerk subject, e.g. `user_test_a` — becomes `users.clerk_user_id`. */
  sub: string;
  /** PostgREST role; RLS predicates use `authenticated`. */
  role?: "authenticated" | "anon";
  /** Extra claims (e.g. `sid`, `email`) — never real personal data in tests. */
  extra?: JWTPayload;
  /** Lifetime in seconds (default 1 hour). */
  expiresInSeconds?: number;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(
    process.env.SUPABASE_JWT_SECRET ?? LOCAL_SUPABASE_JWT_SECRET_FALLBACK,
  );
}

export async function mintLocalJwt(claims: ClerkShapedClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    role: claims.role ?? "authenticated",
    aud: "authenticated",
    ...claims.extra,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer("https://clerk.test.local")
    .setIssuedAt(now)
    .setExpirationTime(now + (claims.expiresInSeconds ?? 3600))
    .sign(secretKey());
}

export async function verifyLocalJwt(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
  return payload;
}
