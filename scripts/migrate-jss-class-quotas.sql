-- Split the legacy shared JSS quota into independent JSS1/JSS2/JSS3 values.
-- Safe to run repeatedly.
ALTER TABLE subject_quotas ADD COLUMN IF NOT EXISTS jss1_quota integer;
ALTER TABLE subject_quotas ADD COLUMN IF NOT EXISTS jss2_quota integer;
ALTER TABLE subject_quotas ADD COLUMN IF NOT EXISTS jss3_quota integer;

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS jss1_quota integer;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS jss2_quota integer;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS jss3_quota integer;

UPDATE subject_quotas
SET jss1_quota = COALESCE(jss1_quota, jss_quota),
    jss2_quota = COALESCE(jss2_quota, jss_quota),
    jss3_quota = COALESCE(jss3_quota, jss_quota);

UPDATE subjects
SET jss1_quota = COALESCE(jss1_quota, jss_quota),
    jss2_quota = COALESCE(jss2_quota, jss_quota),
    jss3_quota = COALESCE(jss3_quota, jss_quota);
