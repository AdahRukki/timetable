-- Split per-class-level quotas into per-class quotas.
--
-- Before: subjects/subject_quotas had jss_quota (covered JSS1+JSS2+JSS3),
--         ss1_quota, and ss2ss3_quota (covered SS2+SS3). preferred_periods
--         and required_doubles were keyed by 'jss' / 'ss1' / 'ss2ss3'.
-- After:  separate columns and JSON keys for jss1, jss2, jss3, ss1, ss2, ss3.
--
-- Run this BEFORE pulling the new app code and BEFORE running `npm run db:push`.
-- The script preserves every existing user's quotas by copying the shared
-- value into each new column / JSON key.
--
-- Idempotent: safe to re-run. Detects the legacy schema by the presence of
-- the old `jss_quota` column.
--
-- Usage on the VPS (psql):
--   psql "$DATABASE_URL" -f scripts/migrate-split-quotas.sql

BEGIN;

-- ===== subjects =====
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subjects' AND column_name = 'jss_quota'
  ) THEN
    ALTER TABLE subjects
      ADD COLUMN IF NOT EXISTS jss1_quota integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS jss2_quota integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS jss3_quota integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ss2_quota  integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ss3_quota  integer NOT NULL DEFAULT 0;

    UPDATE subjects SET
      jss1_quota = COALESCE(jss_quota, 0),
      jss2_quota = COALESCE(jss_quota, 0),
      jss3_quota = COALESCE(jss_quota, 0),
      ss2_quota  = COALESCE(ss2ss3_quota, 0),
      ss3_quota  = COALESCE(ss2ss3_quota, 0);

    UPDATE subjects SET preferred_periods = jsonb_build_object(
      'jss1', COALESCE(preferred_periods->'jss',    '[]'::jsonb),
      'jss2', COALESCE(preferred_periods->'jss',    '[]'::jsonb),
      'jss3', COALESCE(preferred_periods->'jss',    '[]'::jsonb),
      'ss1',  COALESCE(preferred_periods->'ss1',    '[]'::jsonb),
      'ss2',  COALESCE(preferred_periods->'ss2ss3', '[]'::jsonb),
      'ss3',  COALESCE(preferred_periods->'ss2ss3', '[]'::jsonb)
    );

    UPDATE subjects SET required_doubles = jsonb_build_object(
      'jss1', COALESCE(required_doubles->'jss',    '0'::jsonb),
      'jss2', COALESCE(required_doubles->'jss',    '0'::jsonb),
      'jss3', COALESCE(required_doubles->'jss',    '0'::jsonb),
      'ss1',  COALESCE(required_doubles->'ss1',    '0'::jsonb),
      'ss2',  COALESCE(required_doubles->'ss2ss3', '0'::jsonb),
      'ss3',  COALESCE(required_doubles->'ss2ss3', '0'::jsonb)
    );

    ALTER TABLE subjects
      DROP COLUMN jss_quota,
      DROP COLUMN ss2ss3_quota;

    ALTER TABLE subjects
      ALTER COLUMN preferred_periods SET DEFAULT
        '{"jss1": [], "jss2": [], "jss3": [], "ss1": [], "ss2": [], "ss3": []}'::jsonb,
      ALTER COLUMN required_doubles SET DEFAULT
        '{"jss1": 0, "jss2": 0, "jss3": 0, "ss1": 0, "ss2": 0, "ss3": 0}'::jsonb;
  END IF;
END $$;

-- ===== subject_quotas =====
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subject_quotas' AND column_name = 'jss_quota'
  ) THEN
    ALTER TABLE subject_quotas
      ADD COLUMN IF NOT EXISTS jss1_quota integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS jss2_quota integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS jss3_quota integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ss2_quota  integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ss3_quota  integer NOT NULL DEFAULT 0;

    UPDATE subject_quotas SET
      jss1_quota = COALESCE(jss_quota, 0),
      jss2_quota = COALESCE(jss_quota, 0),
      jss3_quota = COALESCE(jss_quota, 0),
      ss2_quota  = COALESCE(ss2ss3_quota, 0),
      ss3_quota  = COALESCE(ss2ss3_quota, 0);

    UPDATE subject_quotas SET preferred_periods = jsonb_build_object(
      'jss1', COALESCE(preferred_periods->'jss',    '[]'::jsonb),
      'jss2', COALESCE(preferred_periods->'jss',    '[]'::jsonb),
      'jss3', COALESCE(preferred_periods->'jss',    '[]'::jsonb),
      'ss1',  COALESCE(preferred_periods->'ss1',    '[]'::jsonb),
      'ss2',  COALESCE(preferred_periods->'ss2ss3', '[]'::jsonb),
      'ss3',  COALESCE(preferred_periods->'ss2ss3', '[]'::jsonb)
    );

    UPDATE subject_quotas SET required_doubles = jsonb_build_object(
      'jss1', COALESCE(required_doubles->'jss',    '0'::jsonb),
      'jss2', COALESCE(required_doubles->'jss',    '0'::jsonb),
      'jss3', COALESCE(required_doubles->'jss',    '0'::jsonb),
      'ss1',  COALESCE(required_doubles->'ss1',    '0'::jsonb),
      'ss2',  COALESCE(required_doubles->'ss2ss3', '0'::jsonb),
      'ss3',  COALESCE(required_doubles->'ss2ss3', '0'::jsonb)
    );

    ALTER TABLE subject_quotas
      DROP COLUMN jss_quota,
      DROP COLUMN ss2ss3_quota;

    ALTER TABLE subject_quotas
      ALTER COLUMN preferred_periods SET DEFAULT
        '{"jss1": [], "jss2": [], "jss3": [], "ss1": [], "ss2": [], "ss3": []}'::jsonb,
      ALTER COLUMN required_doubles SET DEFAULT
        '{"jss1": 0, "jss2": 0, "jss3": 0, "ss1": 0, "ss2": 0, "ss3": 0}'::jsonb;
  END IF;
END $$;

COMMIT;
