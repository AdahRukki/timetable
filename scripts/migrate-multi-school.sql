-- Multi-school workspace migration.
-- Existing single-school data is placed into one default active school per user.
-- Users can rename that school after deployment and create additional schools.

CREATE TABLE IF NOT EXISTS schools (
  id varchar PRIMARY KEY,
  user_id varchar NOT NULL,
  name text NOT NULL,
  is_active integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS school_settings (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL,
  school_id varchar NOT NULL,
  fatigue_limit integer NOT NULL DEFAULT 5,
  max_free_periods_per_week integer NOT NULL DEFAULT 3,
  max_free_periods_per_day integer NOT NULL DEFAULT 2,
  free_periods_per_class jsonb NOT NULL DEFAULT '{}'::jsonb,
  allow_double_periods integer NOT NULL DEFAULT 1,
  allow_double_in_p8p9 integer NOT NULL DEFAULT 1
);

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS school_id varchar;
ALTER TABLE timetable_slots ADD COLUMN IF NOT EXISTS school_id varchar;
ALTER TABLE timetable_actions ADD COLUMN IF NOT EXISTS school_id varchar;
ALTER TABLE subject_quotas ADD COLUMN IF NOT EXISTS school_id varchar;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS school_id varchar;
ALTER TABLE shared_timetables ADD COLUMN IF NOT EXISTS school_id varchar;
ALTER TABLE saved_timetables ADD COLUMN IF NOT EXISTS school_id varchar;

WITH owners AS (
  SELECT user_id FROM teachers
  UNION SELECT user_id FROM timetable_slots
  UNION SELECT user_id FROM timetable_actions
  UNION SELECT user_id FROM subject_quotas
  UNION SELECT user_id FROM subjects
  UNION SELECT user_id FROM shared_timetables
  UNION SELECT user_id FROM saved_timetables
  UNION SELECT user_id FROM user_settings
)
INSERT INTO schools (id, user_id, name, is_active, created_at)
SELECT
  'school_' || md5(user_id),
  user_id,
  'My School',
  1,
  (extract(epoch from clock_timestamp()) * 1000)::bigint
FROM owners
WHERE user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Ensure one active school exists for every migrated owner.
UPDATE schools s
SET is_active = 1
WHERE s.id = 'school_' || md5(s.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM schools a
    WHERE a.user_id = s.user_id AND a.is_active = 1
  );

UPDATE teachers SET school_id = 'school_' || md5(user_id) WHERE school_id IS NULL;
UPDATE timetable_slots SET school_id = 'school_' || md5(user_id) WHERE school_id IS NULL;
UPDATE timetable_actions SET school_id = 'school_' || md5(user_id) WHERE school_id IS NULL;
UPDATE subject_quotas SET school_id = 'school_' || md5(user_id) WHERE school_id IS NULL;
UPDATE subjects SET school_id = 'school_' || md5(user_id) WHERE school_id IS NULL;
UPDATE shared_timetables SET school_id = 'school_' || md5(user_id) WHERE school_id IS NULL;
UPDATE saved_timetables SET school_id = 'school_' || md5(user_id) WHERE school_id IS NULL;

INSERT INTO school_settings (
  user_id,
  school_id,
  fatigue_limit,
  max_free_periods_per_week,
  max_free_periods_per_day,
  free_periods_per_class,
  allow_double_periods,
  allow_double_in_p8p9
)
SELECT
  u.user_id,
  'school_' || md5(u.user_id),
  u.fatigue_limit,
  u.max_free_periods_per_week,
  u.max_free_periods_per_day,
  u.free_periods_per_class,
  u.allow_double_periods,
  u.allow_double_in_p8p9
FROM user_settings u
WHERE NOT EXISTS (
  SELECT 1 FROM school_settings s
  WHERE s.user_id = u.user_id
    AND s.school_id = 'school_' || md5(u.user_id)
);

-- Users without legacy settings still need per-school defaults.
INSERT INTO school_settings (user_id, school_id)
SELECT s.user_id, s.id
FROM schools s
WHERE NOT EXISTS (
  SELECT 1 FROM school_settings x
  WHERE x.user_id = s.user_id AND x.school_id = s.id
);

ALTER TABLE teachers ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE timetable_slots ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE timetable_actions ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE subject_quotas ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE subjects ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE shared_timetables ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE saved_timetables ALTER COLUMN school_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schools_user_id ON schools(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_one_active_per_user
  ON schools(user_id) WHERE is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS school_settings_user_school_unique
  ON school_settings(user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_teachers_user_school ON teachers(user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_user_school ON timetable_slots(user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_timetable_actions_user_school ON timetable_actions(user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_subject_quotas_user_school ON subject_quotas(user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_subjects_user_school ON subjects(user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_shared_timetables_user_school ON shared_timetables(user_id, school_id);
CREATE INDEX IF NOT EXISTS idx_saved_timetables_user_school ON saved_timetables(user_id, school_id);
