-- =============================================================================
-- 0005 — Document types for document intelligence (ADR-005, ADR-008)
--
-- Adds CSV and PowerPoint (.pptx) to the private `documents` bucket so they can
-- be stored and analysed. The accepted set is defined once in
-- lib/uploads/file-types.ts; this allow-list is the storage-level backstop and
-- must stay a superset of it.
--
-- Only the allow-list changes. The bucket stays private, the 50 MB limit is
-- unchanged, and 0004 is not edited — applied migrations are never rewritten.
-- =============================================================================

update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/jpeg',
     'image/png',
     'image/webp',
     'image/heic',
     'text/plain',
     'text/csv',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation'
   ]
 where id = 'documents';
