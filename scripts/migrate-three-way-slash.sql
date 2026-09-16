-- Add optional third member support to slash subject groups.
-- Safe to run repeatedly.
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS slash_third_name text;
ALTER TABLE timetable_slots ADD COLUMN IF NOT EXISTS slash_third_subject text;
ALTER TABLE timetable_slots ADD COLUMN IF NOT EXISTS slash_third_teacher_id varchar;
