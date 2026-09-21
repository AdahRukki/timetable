-- Split the legacy shared SS2/SS3 slash-subject group into independent
-- configurations. Existing pairings are copied to both classes so this
-- migration preserves the timetable until the user edits either class.

BEGIN;

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS ss2_slash_pair_name text;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS ss2_slash_third_name text;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS ss3_slash_pair_name text;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS ss3_slash_third_name text;

UPDATE subjects
SET
  ss2_slash_pair_name = COALESCE(ss2_slash_pair_name, slash_pair_name),
  ss2_slash_third_name = COALESCE(ss2_slash_third_name, slash_third_name),
  ss3_slash_pair_name = COALESCE(ss3_slash_pair_name, slash_pair_name),
  ss3_slash_third_name = COALESCE(ss3_slash_third_name, slash_third_name)
-- Only untouched legacy rows need backfilling. A NULL in one class may be
-- an intentional unpairing; an absent third member may mean a two-way group.
-- Never fill these from the other class when this script is rerun.
WHERE is_slash_subject = 1
  AND ss2_slash_pair_name IS NULL
  AND ss2_slash_third_name IS NULL
  AND ss3_slash_pair_name IS NULL
  AND ss3_slash_third_name IS NULL;

COMMIT;
