-- =============================================================================
-- 0008 — Asset categories for the Asset Vault
--
-- Additive only. New values on the three asset-category enums so the vault can
-- record asset types that had no equivalent before: generic investments,
-- cryptocurrency holdings, websites, digital businesses, intellectual property
-- and a custom "Other" class for financial and physical assets.
--
-- Nothing else changes: no table, column, grant, policy or function is touched,
-- and existing rows keep their values. `create_asset()` casts the category text
-- to the enum, so the new values are accepted through the same guarded path.
--
-- Re-runnable: ADD VALUE IF NOT EXISTS is idempotent. The new values are not
-- used inside this migration (Postgres forbids that in the same transaction).
-- =============================================================================

alter type public.financial_asset_category add value if not exists 'INVESTMENT';
alter type public.financial_asset_category add value if not exists 'CRYPTOCURRENCY';
alter type public.financial_asset_category add value if not exists 'OTHER';

alter type public.physical_asset_category add value if not exists 'OTHER';

alter type public.digital_asset_category add value if not exists 'WEBSITE';
alter type public.digital_asset_category add value if not exists 'DIGITAL_BUSINESS';
alter type public.digital_asset_category add value if not exists 'INTELLECTUAL_PROPERTY';
