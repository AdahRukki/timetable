from pathlib import Path

path = Path("server/routes.ts")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match for {label}, found {count}")
    text = text.replace(old, new, 1)


# 1) Coverage metrics used by final warnings and attempt scoring.
marker = '''function countTeacherLoad(timetable: Timetable, teacherId: string): number {\n'''
insert = '''type CoverageMetrics = {\n  zeroRequiredSubjects: string[];\n  missingPeriods: number;\n};\n\nfunction getCoverageMetrics(timetable: Timetable, quotas: SubjectQuota[]): CoverageMetrics {\n  const zeroRequiredSubjects: string[] = [];\n  let missingPeriods = 0;\n  for (const cls of CLASSES) {\n    for (const quota of quotas) {\n      const needed = getQuotaForClass(quota, cls);\n      if (needed <= 0) continue;\n      const placed = countPlacements(timetable, cls, quota.subject);\n      if (placed === 0) zeroRequiredSubjects.push(`${cls}:${quota.subject}`);\n      if (placed < needed) missingPeriods += needed - placed;\n    }\n  }\n  return { zeroRequiredSubjects, missingPeriods };\n}\n\nfunction countTeacherLoad(timetable: Timetable, teacherId: string): number {\n'''
replace_once(marker, insert, "coverage metrics insertion")

# 2) First-occurrence guarantee before required doubles / repeat allocations.
marker = '''  // PHASE 2.5: Required doubles pre-pass — for each (cls, subject), place the\n'''
insert = '''  // PHASE 2.25: First-occurrence guarantee. Every subject with quota > 0\n  // gets a chance to receive one legal single period before any subject is\n  // allowed to consume repeat periods. Constrained subjects (fewest eligible\n  // teachers) are attempted first. SS2/SS3 slash groups were already handled\n  // atomically in Phase 1 and must never be split here.\n  for (const cls of shuffle([...CLASSES] as SchoolClass[])) {\n    const remaining = remainingByClass.get(cls)!;\n    const candidates = quotas\n      .filter((quota) => {\n        if (getQuotaForClass(quota, cls) <= 0) return false;\n        if (quota.isSlashSubject && (cls === "SS2" || cls === "SS3")) return false;\n        if (countPlacements(timetable, cls, quota.subject) > 0) return false;\n        return (remaining.get(quota.subject) ?? 0) > 0;\n      })\n      .map((quota) => ({\n        quota,\n        eligibleCount: teachers.filter((t) =>\n          teacherCanTeachSubjectToClass(t, quota.subject, cls),\n        ).length,\n      }));\n\n    // Shuffle first so subjects with equal constraint levels do not always\n    // receive the same deterministic ordering across attempts.\n    const ordered = shuffle(candidates).sort((a, b) => a.eligibleCount - b.eligibleCount);\n    for (const { quota } of ordered) {\n      const subject = quota.subject;\n      const remNeeded = remaining.get(subject) ?? 0;\n      if (remNeeded <= 0 || countPlacements(timetable, cls, subject) > 0) continue;\n      const placed = placeOneSubjectPeriod(\n        timetable, cls, subject, teachers, fatigueLimit, 1, flaggedIds,\n        getPreferredPeriods(quota, cls), singleOnlySubjects,\n      );\n      if (placed > 0) {\n        const newRem = remNeeded - placed;\n        if (newRem <= 0) remaining.delete(subject);\n        else remaining.set(subject, newRem);\n      }\n    }\n  }\n\n  // PHASE 2.5: Required doubles pre-pass — for each (cls, subject), place the\n'''
replace_once(marker, insert, "first-occurrence guarantee phase")

# 3) Never sacrifice a donor class's required quota during cross-class DROP.
marker = '''          // RELOCATE failed. Fall back to DROP: empty c2's slot.\n          // Only do this if it strictly improves the max-class-empty score.\n          const newWorstEmpty = worstEmpty - 1;\n'''
insert = '''          // RELOCATE failed. Fall back to DROP only when the donor subject\n          // is genuinely above its configured quota. Fairness must never\n          // create a new subject shortage (especially a zero-occurrence one).\n          const donorQuota = quotas.find((q) => q.subject === c2OriginalSubject);\n          const donorNeeded = donorQuota ? getQuotaForClass(donorQuota, c2) : 0;\n          const donorPlaced = countPlacements(timetable, c2, c2OriginalSubject);\n          if (donorNeeded > 0 && donorPlaced <= donorNeeded) continue;\n\n          // Only do this if it strictly improves the max-class-empty score.\n          const newWorstEmpty = worstEmpty - 1;\n'''
replace_once(marker, insert, "quota-safe donor drop")

# 4) Emit explicit critical warning when a required subject is absent entirely.
marker = '''  // After rebalancing, if any one class is still significantly worse off than\n'''
insert = '''  const finalCoverage = getCoverageMetrics(timetable, quotas);\n  if (finalCoverage.zeroRequiredSubjects.length > 0) {\n    warnings.push(\n      `CRITICAL: Required subject(s) with zero timetable occurrences: ${finalCoverage.zeroRequiredSubjects.join(", ")}`,\n    );\n  }\n\n  // After rebalancing, if any one class is still significantly worse off than\n'''
replace_once(marker, insert, "critical zero-occurrence warning")

# 5) Make subject coverage the first criterion when selecting the best attempt.
old = '''  type AttemptResult = {\n    timetable: Timetable;\n    emptyCount: number;\n    warnings: string[];\n    emptyP1: number;\n    worstClassEmpty: number;\n    flaggedDayOff: number;\n  };\n  let best: AttemptResult | null = null;\n  const cmp = (a: AttemptResult, b: AttemptResult): number => {\n    if (a.emptyP1 !== b.emptyP1) return a.emptyP1 - b.emptyP1;\n    if (a.worstClassEmpty !== b.worstClassEmpty) return a.worstClassEmpty - b.worstClassEmpty;\n    if (a.emptyCount !== b.emptyCount) return a.emptyCount - b.emptyCount;\n    return b.flaggedDayOff - a.flaggedDayOff; // more day-offs is better\n  };\n'''
new = '''  type AttemptResult = {\n    timetable: Timetable;\n    emptyCount: number;\n    warnings: string[];\n    zeroRequiredCount: number;\n    missingRequiredPeriods: number;\n    emptyP1: number;\n    worstClassEmpty: number;\n    flaggedDayOff: number;\n  };\n  let best: AttemptResult | null = null;\n  const cmp = (a: AttemptResult, b: AttemptResult): number => {\n    // Subject coverage is a hard priority: never prefer a prettier/full-looking\n    // timetable that completely omits a required subject.\n    if (a.zeroRequiredCount !== b.zeroRequiredCount) return a.zeroRequiredCount - b.zeroRequiredCount;\n    if (a.missingRequiredPeriods !== b.missingRequiredPeriods) return a.missingRequiredPeriods - b.missingRequiredPeriods;\n    if (a.emptyP1 !== b.emptyP1) return a.emptyP1 - b.emptyP1;\n    if (a.worstClassEmpty !== b.worstClassEmpty) return a.worstClassEmpty - b.worstClassEmpty;\n    if (a.emptyCount !== b.emptyCount) return a.emptyCount - b.emptyCount;\n    return b.flaggedDayOff - a.flaggedDayOff; // more day-offs is better\n  };\n'''
replace_once(old, new, "attempt score type/comparator")

old = '''    const scored: AttemptResult = {\n      ...r,\n      emptyP1: countEmptyP1(r.timetable),\n      worstClassEmpty: maxClassEmpty(r.timetable),\n      flaggedDayOff: countFlaggedTeachersWithDayOff(r.timetable, flaggedIds),\n    };\n    if (!best || cmp(scored, best) < 0) {\n      best = scored;\n    }\n    if (best.emptyP1 === 0 && best.emptyCount <= EARLY_EXIT_EMPTY) break;\n'''
new = '''    const coverage = getCoverageMetrics(r.timetable, quotas);\n    const scored: AttemptResult = {\n      ...r,\n      zeroRequiredCount: coverage.zeroRequiredSubjects.length,\n      missingRequiredPeriods: coverage.missingPeriods,\n      emptyP1: countEmptyP1(r.timetable),\n      worstClassEmpty: maxClassEmpty(r.timetable),\n      flaggedDayOff: countFlaggedTeachersWithDayOff(r.timetable, flaggedIds),\n    };\n    if (!best || cmp(scored, best) < 0) {\n      best = scored;\n    }\n    if (\n      best.zeroRequiredCount === 0 &&\n      best.missingRequiredPeriods === 0 &&\n      best.emptyP1 === 0 &&\n      best.emptyCount <= EARLY_EXIT_EMPTY\n    ) break;\n'''
replace_once(old, new, "attempt coverage scoring")

path.write_text(text)
print("Subject coverage guarantee patch applied")
