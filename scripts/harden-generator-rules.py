from pathlib import Path

path = Path("server/routes.ts")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match for {label}, found {count}")
    text = text.replace(old, new, 1)

# Manual placement must obey the saved double-period settings too.
old = '''  const fatigueLimit = userSettings.fatigueLimit;\n\n  const teacher = teachers.find((t) => t.id === teacherId);\n'''
new = '''  const fatigueLimit = userSettings.fatigueLimit;\n\n  if (slotType === "double" && !userSettings.allowDoublePeriods) {\n    errors.push({\n      code: "DOUBLE_PERIODS_DISABLED",\n      message: "Double periods are disabled in Settings",\n      severity: "error",\n    });\n  }\n  if (slotType === "double" && period === 8 && !userSettings.allowDoubleInP8P9) {\n    errors.push({\n      code: "DOUBLE_P8P9_DISABLED",\n      message: "Double periods in P8/P9 are disabled in Settings",\n      severity: "error",\n    });\n  }\n\n  const teacher = teachers.find((t) => t.id === teacherId);\n'''
replace_once(old, new, "manual double settings enforcement")

# Auto-placement respects global double settings.
old = '''  relaxDailyRule = false,\n  singleOnlySubjects?: ReadonlySet<string>,\n): number {\n'''
new = '''  relaxDailyRule = false,\n  singleOnlySubjects?: ReadonlySet<string>,\n  allowDoublePeriods = true,\n  allowDoubleInP8P9 = true,\n): number {\n'''
replace_once(old, new, "tryPlace signature")

old = '''  const canDouble = allowDouble && !singleOnlySubjects?.has(subject);\n  if (canDouble && period < PERIODS_PER_DAY[day] && !wouldCrossBreak(day, period)) {\n'''
new = '''  const canDouble =\n    allowDouble &&\n    allowDoublePeriods &&\n    !singleOnlySubjects?.has(subject) &&\n    (allowDoubleInP8P9 || period !== 8);\n  if (canDouble && period < PERIODS_PER_DAY[day] && !wouldCrossBreak(day, period)) {\n'''
replace_once(old, new, "tryPlace global double rules")

# Strict double helper: required-double pass must never silently consume a single.
marker = '''function scheduleSubject(\n'''
insert = '''function tryPlaceStrictDouble(\n  timetable: Timetable,\n  cls: SchoolClass,\n  day: Day,\n  period: number,\n  subject: string,\n  teacher: Teacher,\n  fatigueLimit: number,\n  singleOnlySubjects: ReadonlySet<string>,\n  allowDoublePeriods: boolean,\n  allowDoubleInP8P9: boolean,\n): number {\n  if (!allowDoublePeriods || singleOnlySubjects.has(subject)) return 0;\n  if (!allowDoubleInP8P9 && period === 8) return 0;\n  if (period >= PERIODS_PER_DAY[day] || wouldCrossBreak(day, period)) return 0;\n  if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) return 0;\n\n  const slot1 = timetable.get(slotKey(day, cls, period));\n  const slot2 = timetable.get(slotKey(day, cls, period + 1));\n  if (!slot1 || !slot2 || slot1.status !== "empty" || slot2.status !== "empty") return 0;\n  if (isTeacherUnavailable(teacher, day, period) || isTeacherUnavailable(teacher, day, period + 1)) return 0;\n  if (!isTeacherFreeAt(timetable, teacher.id, day, period) || !isTeacherFreeAt(timetable, teacher.id, day, period + 1)) return 0;\n  if (wouldExceedFatigue(\n    timetable, teacher.id, day, [period, period + 1], fatigueLimit, teacher.maxConsecutivePeriods ?? null,\n  )) return 0;\n\n  placeSlot(timetable, cls, day, period, subject, teacher.id, "double", period + 1);\n  return 2;\n}\n\nfunction scheduleSubject(\n'''
replace_once(marker, insert, "strict double helper")

# Free-period metrics and day ordering.
marker = '''function countEmptyP1(timetable: Timetable): number {\n'''
insert = '''function countEmptyForClassOnDay(timetable: Timetable, cls: SchoolClass, day: Day): number {\n  let count = 0;\n  for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {\n    const slot = timetable.get(slotKey(day, cls, p));\n    if (!slot || slot.status === "empty") count++;\n  }\n  return count;\n}\n\ntype FreePeriodMetrics = { dailyExcess: number; weeklyExcess: number };\nfunction getFreePeriodMetrics(\n  timetable: Timetable,\n  freePeriodsPerClass: Record<string, number>,\n  defaultMaxFreePerWeek: number,\n  maxFreePeriodsPerDay: number,\n): FreePeriodMetrics {\n  let dailyExcess = 0;\n  let weeklyExcess = 0;\n  for (const cls of CLASSES) {\n    const weeklyFree = countEmptyForClass(timetable, cls);\n    const weeklyCap = getMaxFreeForClass(cls, freePeriodsPerClass, defaultMaxFreePerWeek);\n    weeklyExcess += Math.max(0, weeklyFree - weeklyCap);\n    for (const day of DAYS) {\n      dailyExcess += Math.max(0, countEmptyForClassOnDay(timetable, cls, day) - maxFreePeriodsPerDay);\n    }\n  }\n  return { dailyExcess, weeklyExcess };\n}\n\nfunction countEmptyP1(timetable: Timetable): number {\n'''
replace_once(marker, insert, "free period metrics")

marker = '''function placeOneSubjectPeriod(\n'''
insert = '''function daysByFreeNeed(\n  timetable: Timetable,\n  cls: SchoolClass,\n  maxFreePeriodsPerDay: number,\n): Day[] {\n  const days = shuffle([...DAYS] as Day[]);\n  days.sort((a, b) => {\n    const ea = countEmptyForClassOnDay(timetable, cls, a);\n    const eb = countEmptyForClassOnDay(timetable, cls, b);\n    const xa = Math.max(0, ea - maxFreePeriodsPerDay);\n    const xb = Math.max(0, eb - maxFreePeriodsPerDay);\n    if (xa !== xb) return xb - xa;\n    return eb - ea;\n  });\n  return days;\n}\n\nfunction placeOneSubjectPeriod(\n'''
replace_once(marker, insert, "day free-need ordering helper")

old = '''  preferredPeriods: number[] = [],\n  singleOnlySubjects?: ReadonlySet<string>,\n): number {\n'''
new = '''  preferredPeriods: number[] = [],\n  singleOnlySubjects?: ReadonlySet<string>,\n  maxFreePeriodsPerDay = 2,\n  allowDoublePeriods = true,\n  allowDoubleInP8P9 = true,\n): number {\n'''
replace_once(old, new, "placeOneSubjectPeriod signature")

old = '''  for (const day of shuffle([...DAYS] as Day[])) {\n    if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) continue;\n'''
new = '''  for (const day of daysByFreeNeed(timetable, cls, maxFreePeriodsPerDay)) {\n    if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) continue;\n'''
# The exact loop appears in several functions. Replace the first occurrence after placeOneSubjectPeriod only.
pos = text.find('function placeOneSubjectPeriod(')
if pos < 0:
    raise SystemExit('placeOneSubjectPeriod not found')
idx = text.find(old, pos)
if idx < 0:
    raise SystemExit('placeOneSubjectPeriod day loop not found')
text = text[:idx] + new + text[idx+len(old):]

old = '''          fatigueLimit, remainingNeeded >= 2, false, singleOnlySubjects,\n        );\n'''
new = '''          fatigueLimit, remainingNeeded >= 2, false, singleOnlySubjects,\n          allowDoublePeriods, allowDoubleInP8P9,\n        );\n'''
replace_once(old, new, "placeOneSubjectPeriod double settings")

# Required-double and coverage metrics.
marker = '''function countTeacherLoad(timetable: Timetable, teacherId: string): number {\n'''
insert = '''function countDoubleBlocks(timetable: Timetable, cls: SchoolClass, subject: string): number {\n  let blocks = 0;\n  for (const day of DAYS) {\n    for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {\n      const slot = timetable.get(slotKey(day, cls, p));\n      if (!slot || slot.status !== "occupied" || slot.slotType !== "double" || slot.subject !== subject) continue;\n      const prev = p > 1 ? timetable.get(slotKey(day, cls, p - 1)) : undefined;\n      if (prev?.status === "occupied" && prev.slotType === "double" && prev.subject === subject) continue;\n      blocks++;\n    }\n  }\n  return blocks;\n}\n\nfunction getRequiredDoubleDeficit(timetable: Timetable, quotas: SubjectQuota[]): number {\n  let deficit = 0;\n  for (const cls of CLASSES) {\n    for (const quota of quotas) {\n      const required = getRequiredDoubles(quota, cls);\n      if (required <= 0) continue;\n      if (quota.isSlashSubject && (cls === "SS2" || cls === "SS3")) continue;\n      const actual = countDoubleBlocks(timetable, cls, quota.subject);\n      deficit += Math.max(0, required - actual);\n    }\n  }\n  return deficit;\n}\n\nfunction countTeacherLoad(timetable: Timetable, teacherId: string): number {\n'''
replace_once(marker, insert, "required-double metrics")

# Pre-validation catches impossible configurations earlier.
old = '''function preValidate(teachers: Teacher[], quotas: SubjectQuota[], warnings: string[]): void {\n'''
new = '''function preValidate(\n  teachers: Teacher[],\n  quotas: SubjectQuota[],\n  warnings: string[],\n  allowDoublePeriods: boolean,\n): void {\n'''
replace_once(old, new, "preValidate signature")

old = '''      const needed = getQuotaForClass(quota, cls);\n      if (needed === 0) continue;\n      const eligible = teachers.filter(t => teacherCanTeachSubjectToClass(t, quota.subject, cls));\n'''
new = '''      const needed = getQuotaForClass(quota, cls);\n      if (needed === 0) continue;\n      const requiredDoubles = getRequiredDoubles(quota, cls);\n      if (quota.singleOnly && needed > DAYS.length) {\n        warnings.push(`PRE-VALIDATE: ${quota.subject} → ${cls} is single-only with quota ${needed}; at most ${DAYS.length} periods fit under the once-per-day rule`);\n      }\n      if (requiredDoubles * 2 > needed) {\n        warnings.push(`PRE-VALIDATE: ${quota.subject} → ${cls} requests ${requiredDoubles} double block(s) but quota ${needed} is too small`);\n      }\n      if (requiredDoubles > 0 && (!allowDoublePeriods || quota.singleOnly)) {\n        warnings.push(`PRE-VALIDATE: ${quota.subject} → ${cls} requires doubles but doubles are disabled for this configuration`);\n      }\n      if (quota.isSlashSubject && (cls === "SS2" || cls === "SS3") && needed > DAYS.length) {\n        warnings.push(`PRE-VALIDATE: Slash subject ${quota.subject} → ${cls} needs ${needed}/week but slash groups can occur at most once per day (${DAYS.length}/week)`);\n      }\n      const eligible = teachers.filter(t => teacherCanTeachSubjectToClass(t, quota.subject, cls));\n'''
replace_once(old, new, "preValidate feasibility checks")

# Run-attempt receives generator settings.
old = '''  defaultMaxFreePerWeek: number,\n  flaggedIds: Set<string>,\n): { timetable: Timetable; emptyCount: number; warnings: string[] } {\n'''
new = '''  defaultMaxFreePerWeek: number,\n  maxFreePeriodsPerDay: number,\n  allowDoublePeriods: boolean,\n  allowDoubleInP8P9: boolean,\n  flaggedIds: Set<string>,\n): { timetable: Timetable; emptyCount: number; warnings: string[] } {\n'''
replace_once(old, new, "runAttempt settings signature")

# First-occurrence pass uses daily-free targeting and global double flags (remainingNeeded=1 means single).
old = '''        getPreferredPeriods(quota, cls), singleOnlySubjects,\n      );\n'''
new = '''        getPreferredPeriods(quota, cls), singleOnlySubjects,\n        maxFreePeriodsPerDay, allowDoublePeriods, allowDoubleInP8P9,\n      );\n'''
replace_once(old, new, "first-occurrence settings")

# Required doubles are strict and obey global settings.
old = '''      if (singleOnlySubjects.has(subject)) continue;\n      const quota = quotas.find((q) => q.subject === subject);\n'''
new = '''      const quota = quotas.find((q) => q.subject === subject);\n'''
replace_once(old, new, "required doubles remove early singleOnly skip")

old = '''      const wantDoubles = getRequiredDoubles(quota, cls);\n      if (wantDoubles <= 0) continue;\n      const eligible = teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, cls));\n'''
new = '''      const wantDoubles = getRequiredDoubles(quota, cls);\n      if (wantDoubles <= 0) continue;\n      if (!allowDoublePeriods || singleOnlySubjects.has(subject)) {\n        warnings.push(`Attempt ${attemptNumber}: ${subject} → ${cls}: required doubles cannot be placed because doubles are disabled`);\n        continue;\n      }\n      const eligible = teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, cls));\n'''
replace_once(old, new, "required doubles disabled handling")

old = '''      for (const day of shuffle([...DAYS] as Day[])) {\n        if (placedDoubles >= wantDoubles) break;\n'''
new = '''      for (const day of daysByFreeNeed(timetable, cls, maxFreePeriodsPerDay)) {\n        if (placedDoubles >= wantDoubles) break;\n'''
replace_once(old, new, "required doubles day ordering")

old = '''            const r = tryPlace(\n              timetable, cls, day, period, subject, teacher,\n              fatigueLimit, true, false, singleOnlySubjects,\n            );\n            if (r === 2) {\n              const newRem = remNeeded - 2;\n              if (newRem <= 0) remaining.delete(subject);\n              else remaining.set(subject, newRem);\n              placedDoubles++;\n              placedThisDay = true;\n              break;\n            }\n            // If a single landed accidentally, undo by ignoring — tryPlace only\n            // returns 1 when allowDouble could not fit; treat as a regular\n            // single placement and keep trying for more doubles on other days.\n            if (r === 1) {\n              const newRem = remNeeded - 1;\n              if (newRem <= 0) remaining.delete(subject);\n              else remaining.set(subject, newRem);\n              placedThisDay = true;\n              break;\n            }\n'''
new = '''            const r = tryPlaceStrictDouble(\n              timetable, cls, day, period, subject, teacher, fatigueLimit,\n              singleOnlySubjects, allowDoublePeriods, allowDoubleInP8P9,\n            );\n            if (r === 2) {\n              const newRem = remNeeded - 2;\n              if (newRem <= 0) remaining.delete(subject);\n              else remaining.set(subject, newRem);\n              placedDoubles++;\n              placedThisDay = true;\n              break;\n            }\n'''
replace_once(old, new, "strict required doubles placement")

# Normal round-robin placement obeys settings and daily-free targeting.
old = '''          timetable, cls, subject, teachers, fatigueLimit, remNeeded, flaggedIds, pref, singleOnlySubjects,\n        );\n'''
new = '''          timetable, cls, subject, teachers, fatigueLimit, remNeeded, flaggedIds, pref, singleOnlySubjects,\n          maxFreePeriodsPerDay, allowDoublePeriods, allowDoubleInP8P9,\n        );\n'''
replace_once(old, new, "round-robin settings")

# Re-run P1 repair after day-off consolidation so optimization cannot leave P1 damaged.
old = '''  if (flaggedIds.size > 0) {\n    consolidateTeacherDays(timetable, flaggedIds, teachers, fatigueLimit, lockedSlots);\n  }\n\n  const finalCoverage = getCoverageMetrics(timetable, quotas);\n'''
new = '''  if (flaggedIds.size > 0) {\n    const consolidationMoves = consolidateTeacherDays(timetable, flaggedIds, teachers, fatigueLimit, lockedSlots);\n    if (consolidationMoves > 0) {\n      p1SwapRepair(timetable, teachers, fatigueLimit, lockedSlots);\n      p1SwapRepair(timetable, teachers, fatigueLimit, lockedSlots);\n    }\n  }\n\n  const finalCoverage = getCoverageMetrics(timetable, quotas);\n'''
replace_once(old, new, "post-consolidation P1 repair")

# Final warnings for unmet doubles/free-period caps.
old = '''  if (finalCoverage.zeroRequiredSubjects.length > 0) {\n    warnings.push(\n      `CRITICAL: Required subject(s) with zero timetable occurrences: ${finalCoverage.zeroRequiredSubjects.join(", ")}`,\n    );\n  }\n\n  // After rebalancing, if any one class is still significantly worse off than\n'''
new = '''  if (finalCoverage.zeroRequiredSubjects.length > 0) {\n    warnings.push(\n      `CRITICAL: Required subject(s) with zero timetable occurrences: ${finalCoverage.zeroRequiredSubjects.join(", ")}`,\n    );\n  }\n  const finalDoubleDeficit = getRequiredDoubleDeficit(timetable, quotas);\n  if (finalDoubleDeficit > 0) {\n    warnings.push(`CRITICAL: ${finalDoubleDeficit} required double-period block(s) remain unmet`);\n  }\n  const finalFreeMetrics = getFreePeriodMetrics(\n    timetable, freePeriodsPerClass, defaultMaxFreePerWeek, maxFreePeriodsPerDay,\n  );\n  if (finalFreeMetrics.weeklyExcess > 0) {\n    warnings.push(`CRITICAL: Weekly free-period limits exceeded by ${finalFreeMetrics.weeklyExcess} period(s) across classes`);\n  }\n  if (finalFreeMetrics.dailyExcess > 0) {\n    warnings.push(`CRITICAL: Daily free-period limits exceeded by ${finalFreeMetrics.dailyExcess} period(s) across class-days`);\n  }\n\n  // After rebalancing, if any one class is still significantly worse off than\n'''
replace_once(old, new, "final constraint warnings")

# Auto-generation consumes saved settings and uses them in scoring.
old = '''  const fatigueLimit = userSettings.fatigueLimit;\n\n  // Load existing timetable to determine locked slots\n'''
new = '''  const fatigueLimit = userSettings.fatigueLimit;\n  const maxFreePeriodsPerDay = userSettings.maxFreePeriodsPerDay;\n  const allowDoublePeriods = userSettings.allowDoublePeriods;\n  const allowDoubleInP8P9 = userSettings.allowDoubleInP8P9;\n\n  // Load existing timetable to determine locked slots\n'''
replace_once(old, new, "auto-generation saved settings")

old = '''  preValidate(teachers, quotas, preWarnings);\n'''
new = '''  preValidate(teachers, quotas, preWarnings, allowDoublePeriods);\n'''
replace_once(old, new, "preValidate call")

old = '''    zeroRequiredCount: number;\n    missingRequiredPeriods: number;\n    emptyP1: number;\n'''
new = '''    zeroRequiredCount: number;\n    missingRequiredPeriods: number;\n    requiredDoubleDeficit: number;\n    weeklyFreeExcess: number;\n    dailyFreeExcess: number;\n    emptyP1: number;\n'''
replace_once(old, new, "attempt metrics fields")

old = '''    if (a.zeroRequiredCount !== b.zeroRequiredCount) return a.zeroRequiredCount - b.zeroRequiredCount;\n    if (a.missingRequiredPeriods !== b.missingRequiredPeriods) return a.missingRequiredPeriods - b.missingRequiredPeriods;\n    if (a.emptyP1 !== b.emptyP1) return a.emptyP1 - b.emptyP1;\n'''
new = '''    if (a.zeroRequiredCount !== b.zeroRequiredCount) return a.zeroRequiredCount - b.zeroRequiredCount;\n    if (a.missingRequiredPeriods !== b.missingRequiredPeriods) return a.missingRequiredPeriods - b.missingRequiredPeriods;\n    if (a.requiredDoubleDeficit !== b.requiredDoubleDeficit) return a.requiredDoubleDeficit - b.requiredDoubleDeficit;\n    if (a.weeklyFreeExcess !== b.weeklyFreeExcess) return a.weeklyFreeExcess - b.weeklyFreeExcess;\n    if (a.dailyFreeExcess !== b.dailyFreeExcess) return a.dailyFreeExcess - b.dailyFreeExcess;\n    if (a.emptyP1 !== b.emptyP1) return a.emptyP1 - b.emptyP1;\n'''
replace_once(old, new, "attempt comparator hard constraints")

old = '''      freePeriodsPerClass, defaultMaxFreePerWeek, flaggedIds,\n    );\n    const coverage = getCoverageMetrics(r.timetable, quotas);\n    const scored: AttemptResult = {\n      ...r,\n      zeroRequiredCount: coverage.zeroRequiredSubjects.length,\n      missingRequiredPeriods: coverage.missingPeriods,\n      emptyP1: countEmptyP1(r.timetable),\n'''
new = '''      freePeriodsPerClass, defaultMaxFreePerWeek, maxFreePeriodsPerDay,\n      allowDoublePeriods, allowDoubleInP8P9, flaggedIds,\n    );\n    const coverage = getCoverageMetrics(r.timetable, quotas);\n    const freeMetrics = getFreePeriodMetrics(\n      r.timetable, freePeriodsPerClass, defaultMaxFreePerWeek, maxFreePeriodsPerDay,\n    );\n    const scored: AttemptResult = {\n      ...r,\n      zeroRequiredCount: coverage.zeroRequiredSubjects.length,\n      missingRequiredPeriods: coverage.missingPeriods,\n      requiredDoubleDeficit: getRequiredDoubleDeficit(r.timetable, quotas),\n      weeklyFreeExcess: freeMetrics.weeklyExcess,\n      dailyFreeExcess: freeMetrics.dailyExcess,\n      emptyP1: countEmptyP1(r.timetable),\n'''
replace_once(old, new, "runAttempt call and scoring metrics")

old = '''      best.zeroRequiredCount === 0 &&\n      best.missingRequiredPeriods === 0 &&\n      best.emptyP1 === 0 &&\n'''
new = '''      best.zeroRequiredCount === 0 &&\n      best.missingRequiredPeriods === 0 &&\n      best.requiredDoubleDeficit === 0 &&\n      best.weeklyFreeExcess === 0 &&\n      best.dailyFreeExcess === 0 &&\n      best.emptyP1 === 0 &&\n'''
replace_once(old, new, "early exit hard constraints")

path.write_text(text)
print("Generator hardening patch applied")
