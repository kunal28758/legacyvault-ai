-- =============================================================================
-- 0004 — Private storage buckets (ADR-005, FR-H001–H010, FR-K001–K006)
--
-- Three buckets, all PRIVATE. Nothing in LegacyVault is ever publicly readable:
-- every download is a short-lived signed URL minted server-side after the
-- application has authorised the caller.
--
--   quarantine — every upload lands here first. Objects are promoted out of it
--                only after size, magic bytes and the malware-scan boundary
--                have been satisfied; rejected objects are deleted.
--   documents  — vault documents and their versions.
--   videos     — video legacy messages.
--
-- No storage RLS policy is granted to `authenticated` on purpose. The browser
-- never talks to the storage API with its own credentials: it receives a signed
-- upload URL or a signed download URL, both minted by the service role inside a
-- route that has already checked ownership. Without a policy there is no path
-- for a session token to reach an object directly.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'quarantine',
    'quarantine',
    false,
    524288000, -- 500 MB: the largest thing that may be uploaded (a video)
    null       -- the declared type is not trusted here; it is verified on completion
  ),
  (
    'documents',
    'documents',
    false,
    52428800,  -- 50 MB (FR-H002)
    array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  ),
  (
    'videos',
    'videos',
    false,
    524288000, -- 500 MB (FR-K002)
    array['video/mp4', 'video/webm', 'video/quicktime']
  )
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
