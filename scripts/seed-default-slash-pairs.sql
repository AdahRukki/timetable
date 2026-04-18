-- Seed legacy slash pairings (Physics/Literature, Chemistry/Government, Agric/CRS).
--
-- Run once after deploying the user-defined slash subjects feature.
-- Idempotent: safe to re-run. Only updates a subject row when both sides of
-- the pair already exist for that user, the pair is currently inactive
-- (`is_slash_subject = 0`), and at least one side has no `slash_pair_name`
-- set yet — so a user who has already configured custom pairings is left
-- alone.
--
-- Usage on the VPS (psql):
--   psql "$DATABASE_URL" -f scripts/seed-default-slash-pairs.sql

BEGIN;

WITH default_pairs(a, b) AS (
  VALUES
    ('Physics',   'Literature'),
    ('Chemistry', 'Government'),
    ('Agric',     'CRS')
),
candidates AS (
  SELECT
    sa.user_id,
    sa.id   AS a_id,
    sa.name AS a_name,
    sb.id   AS b_id,
    sb.name AS b_name
  FROM default_pairs dp
  JOIN subjects sa ON sa.name = dp.a
  JOIN subjects sb ON sb.name = dp.b AND sb.user_id = sa.user_id
  WHERE
    sa.is_slash_subject = 0
    AND sb.is_slash_subject = 0
    AND sa.slash_pair_name IS NULL
    AND sb.slash_pair_name IS NULL
)
UPDATE subjects s
SET
  is_slash_subject = 1,
  slash_pair_name  = CASE WHEN s.id = c.a_id THEN c.b_name ELSE c.a_name END
FROM candidates c
WHERE s.id IN (c.a_id, c.b_id);

UPDATE subject_quotas sq
SET is_slash_subject = 1
FROM subjects s
WHERE
  sq.user_id = s.user_id
  AND sq.subject = s.name
  AND s.is_slash_subject = 1
  AND sq.is_slash_subject = 0;

COMMIT;
