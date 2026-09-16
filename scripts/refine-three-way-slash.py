from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f"Missing expected block: {label}")
    p.write_text(text.replace(old, new, 1))


# Client availability must see the third teacher in a slash group.
replace_once(
    "client/src/lib/timetable-utils.ts",
    '''    if (slot && slot.teacherId === teacher.id) return false;
    if (slot && slot.slashPairTeacherId === teacher.id) return false;
''',
    '''    if (slot && slot.teacherId === teacher.id) return false;
    if (slot && slot.slashPairTeacherId === teacher.id) return false;
    if (slot && slot.slashThirdTeacherId === teacher.id) return false;
''',
    "client teacher availability third slash",
)

# Manual slash placement must validate teachers 2 and 3 just as rigorously as
# the server generator: assignment, class, availability/clash and fatigue.
replace_once(
    "client/src/lib/timetable-utils.ts",
    '''    const ids = [teacherId, request.slashPairTeacherId, request.slashThirdTeacherId].filter((id): id is string => !!id);
    if (new Set(ids).size !== ids.length) {
      errors.push({
        code: "SLASH_TEACHER_DUPLICATE",
        message: "Each slash subject must have a different teacher",
        severity: "error",
      });
    }
  }
''',
    '''    const ids = [teacherId, request.slashPairTeacherId, request.slashThirdTeacherId].filter((id): id is string => !!id);
    if (new Set(ids).size !== ids.length) {
      errors.push({
        code: "SLASH_TEACHER_DUPLICATE",
        message: "Each slash subject must have a different teacher",
        severity: "error",
      });
    }

    const extraAssignments = [
      { subject: request.slashPairSubject, teacherId: request.slashPairTeacherId },
      { subject: request.slashThirdSubject, teacherId: request.slashThirdTeacherId },
    ].filter((item): item is { subject: string; teacherId: string | undefined } => !!item.subject);

    for (const assignment of extraAssignments) {
      if (!assignment.teacherId) continue; // missing-teacher error already added above
      const extraTeacher = teachers.find((t) => t.id === assignment.teacherId);
      if (!extraTeacher) {
        errors.push({
          code: "SLASH_TEACHER_NOT_FOUND",
          message: `Teacher for ${assignment.subject} was not found`,
          severity: "error",
        });
        continue;
      }
      if (!extraTeacher.subjects.includes(assignment.subject)) {
        errors.push({
          code: "SLASH_TEACHER_SUBJECT_MISMATCH",
          message: `${extraTeacher.name} is not assigned to teach ${assignment.subject}`,
          severity: "error",
        });
      }
      const subjectClasses = extraTeacher.subjectClasses?.[assignment.subject];
      const classAllowed = extraTeacher.classes.includes(schoolClass) &&
        (!subjectClasses || subjectClasses.length === 0 || subjectClasses.includes(schoolClass));
      if (!classAllowed) {
        errors.push({
          code: "SLASH_TEACHER_CLASS_MISMATCH",
          message: `${extraTeacher.name} is not assigned to teach ${assignment.subject} to ${schoolClass}`,
          severity: "error",
        });
      }
      if (!isTeacherAvailable(timetable, extraTeacher, day, period)) {
        errors.push({
          code: "SLASH_TEACHER_CLASH",
          message: `${extraTeacher.name} is unavailable or already teaching during period ${period}`,
          severity: "error",
        });
      }
      const extraLimit = getEffectiveFatigueLimit(extraTeacher, fatigueLimit);
      if (wouldExceedFatigueLimit(timetable, assignment.teacherId, day, period, false, extraLimit)) {
        errors.push({
          code: "SLASH_TEACHER_FATIGUE",
          message: `${extraTeacher.name} would exceed ${extraLimit} consecutive teaching periods`,
          severity: "error",
        });
      }
    }
  }
''',
    "manual slash extra teacher validation",
)

# Settings summary must count a three-subject slash group as one timetable slot,
# not as two overlapping legacy pairs.
replace_once(
    "client/src/pages/settings.tsx",
    '''                        // For SS2/SS3 totals, slash pairs share a single timetable
                        // slot, so each pair counts once (not twice). We pick one
                        // canonical side per pair (alphabetically first) to count.
                        const seenPairs = new Set<string>();
                        const countedSlashNames = new Set<string>();
                        for (const s of subjects) {
                          if (!s.isSlashSubject) continue;
                          const partner = findSlashPair(subjects, s.name);
                          if (!partner) continue;
                          const key = [s.name, partner.name].sort().join("|");
                          if (seenPairs.has(key)) continue;
                          seenPairs.add(key);
                          countedSlashNames.add(s.name <= partner.name ? s.name : partner.name);
                        }
                        const slashNames = new Set(
                          subjects.filter((s) => s.isSlashSubject && findSlashPair(subjects, s.name)).map((s) => s.name),
                        );
''',
    '''                        // For SS2/SS3 totals, each valid 2- or 3-subject slash
                        // group occupies one timetable slot and must be counted once.
                        const seenGroups = new Set<string>();
                        const slashNames = new Set<string>();
                        let ss2ss3SlashTotal = 0;
                        for (const s of subjects) {
                          if (!s.isSlashSubject) continue;
                          const group = findSlashGroup(subjects, s.name);
                          if (group.length < 2) continue;
                          const names = group.map((item) => item.name).sort();
                          const key = names.join("|");
                          names.forEach((name) => slashNames.add(name));
                          if (seenGroups.has(key)) continue;
                          seenGroups.add(key);
                          ss2ss3SlashTotal += Math.max(
                            ...names.map((name) => quotas.find((q) => q.subject === name)?.ss2ss3Quota ?? 0),
                          );
                        }
''',
    "settings slash group total setup",
)
replace_once(
    "client/src/pages/settings.tsx",
    '''                        const ss2ss3SlashTotal = quotas
                          .filter((q) => countedSlashNames.has(q.subject))
                          .reduce((sum, q) => sum + q.ss2ss3Quota, 0);
                        const ss2ss3RegularTotal = quotas
''',
    '''                        const ss2ss3RegularTotal = quotas
''',
    "settings remove legacy pair total",
)
replace_once(
    "client/src/pages/settings.tsx",
    '''                      if (!v) setNewSubjectSlashPair("");
''',
    '''                      if (!v) {
                        setNewSubjectSlashPair("");
                        setNewSubjectSlashThird("");
                      }
''',
    "settings clear third slash",
)
replace_once(
    "client/src/pages/settings.tsx",
    '''                disabled={!newSubjectName.trim() || createSubjectMutation.isPending || updateSubjectMutation.isPending}
''',
    '''                disabled={!newSubjectName.trim() || (newSubjectIsSlash && !newSubjectSlashPair) || createSubjectMutation.isPending || updateSubjectMutation.isPending}
''',
    "settings require slash partner",
)

# A third slash teacher must count as teaching during day-off consolidation.
replace_once(
    "server/routes.ts",
    '''          if (slot.teacherId !== teacher.id && slot.slashPairTeacherId !== teacher.id) continue;
''',
    '''          if (
            slot.teacherId !== teacher.id &&
            slot.slashPairTeacherId !== teacher.id &&
            slot.slashThirdTeacherId !== teacher.id
          ) continue;
''',
    "day-off third slash teacher",
)

# Round-robin targets are timetable cells, so a slash group counts once rather
# than once per member. This prevents three-way groups from inflating SS2/SS3
# occupancy targets.
replace_once(
    "server/routes.ts",
    '''  const targetPlacedByClass = new Map<SchoolClass, number>();
  for (const cls of CLASSES) {
    let target = 0;
    for (const quota of quotas) target += getQuotaForClass(quota, cls);
    targetPlacedByClass.set(cls, Math.min(target, totalPerClass));
  }
''',
    '''  const targetPlacedByClass = new Map<SchoolClass, number>();
  for (const cls of CLASSES) {
    let target = 0;
    const countedSlashGroups = new Set<string>();
    for (const quota of quotas) {
      if (quota.isSlashSubject && (cls === "SS2" || cls === "SS3")) {
        const group = findSlashGroup(subjects, quota.subject);
        if (group.length >= 2) {
          const names = group.map((s) => s.name).sort();
          const key = names.join("|");
          if (countedSlashGroups.has(key)) continue;
          countedSlashGroups.add(key);
          target += Math.max(
            ...names.map((name) => {
              const groupQuota = quotas.find((q) => q.subject === name);
              return groupQuota ? getQuotaForClass(groupQuota, cls) : 0;
            }),
          );
          continue;
        }
      }
      target += getQuotaForClass(quota, cls);
    }
    targetPlacedByClass.set(cls, Math.min(target, totalPerClass));
  }
''',
    "generator slash group occupancy targets",
)

print("Three-way slash refinements applied")
