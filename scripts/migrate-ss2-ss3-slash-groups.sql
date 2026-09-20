-- Split the legacy shared SS2/SS3 slash-subject group into independent
-- configurations. Existing pairings are copied to both classes so this
-- migration preserves the timetable until the user edits either class.

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
WHERE is_slash_subject = 1;
