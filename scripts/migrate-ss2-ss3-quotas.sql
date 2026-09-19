-- Split the legacy shared SS2/SS3 scheduling settings into independent SS2 and SS3 values.
-- Existing installations keep the same behaviour after migration because both new quotas
-- are initialized from ss2ss3_quota and JSON preferences are copied from ss2ss3.

ALTER TABLE subject_quotas
  ADD COLUMN IF NOT EXISTS ss2_quota integer,
  ADD COLUMN IF NOT EXISTS ss3_quota integer;

ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS ss2_quota integer,
  ADD COLUMN IF NOT EXISTS ss3_quota integer;

UPDATE subject_quotas
SET
  ss2_quota = COALESCE(ss2_quota, ss2ss3_quota),
  ss3_quota = COALESCE(ss3_quota, ss2ss3_quota);

UPDATE subjects
SET
  ss2_quota = COALESCE(ss2_quota, ss2ss3_quota),
  ss3_quota = COALESCE(ss3_quota, ss2ss3_quota);

UPDATE subject_quotas
SET preferred_periods =
  jsonb_set(
    jsonb_set(
      COALESCE(preferred_periods, '{}'::jsonb),
      '{ss2}',
      COALESCE(preferred_periods->'ss2', preferred_periods->'ss2ss3', '[]'::jsonb),
      true
    ),
    '{ss3}',
    COALESCE(preferred_periods->'ss3', preferred_periods->'ss2ss3', '[]'::jsonb),
    true
  ),
  required_doubles =
  jsonb_set(
    jsonb_set(
      COALESCE(required_doubles, '{}'::jsonb),
      '{ss2}',
      COALESCE(required_doubles->'ss2', required_doubles->'ss2ss3', '0'::jsonb),
      true
    ),
    '{ss3}',
    COALESCE(required_doubles->'ss3', required_doubles->'ss2ss3', '0'::jsonb),
    true
  );

UPDATE subjects
SET preferred_periods =
  jsonb_set(
    jsonb_set(
      COALESCE(preferred_periods, '{}'::jsonb),
      '{ss2}',
      COALESCE(preferred_periods->'ss2', preferred_periods->'ss2ss3', '[]'::jsonb),
      true
    ),
    '{ss3}',
    COALESCE(preferred_periods->'ss3', preferred_periods->'ss2ss3', '[]'::jsonb),
    true
  ),
  required_doubles =
  jsonb_set(
    jsonb_set(
      COALESCE(required_doubles, '{}'::jsonb),
      '{ss2}',
      COALESCE(required_doubles->'ss2', required_doubles->'ss2ss3', '0'::jsonb),
      true
    ),
    '{ss3}',
    COALESCE(required_doubles->'ss3', required_doubles->'ss2ss3', '0'::jsonb),
    true
  );
