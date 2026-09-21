import {
  DAYS, CLASSES, PERIODS_PER_DAY, findSlashGroup, getQuotaForClass,
  type Day, type SchoolClass, type Teacher, type Subject, type SubjectQuota,
  type TimetableSlot, type UserSettings, type AutoGenerateResult,
} from "@shared/schema";
import { wouldCrossBreak } from "@shared/timetable-rules";

export interface GenerationInput {
  teachers: Teacher[];
  quotas: SubjectQuota[];
  subjects: Subject[];
  userSettings: UserSettings;
  existingTimetable: Map<string, TimetableSlot>;
}

export interface GenerationPlan {
  result: AutoGenerateResult;
  // Present only after the complete timetable passes validation.
  slots?: TimetableSlot[];
}

// ===== AUTO-GENERATION ALGORITHM (Improved: In-Memory, Bottleneck-First, Swap-Repair) =====

type Timetable = Map<string, TimetableSlot>;

// Break-after map: which period numbers have a break immediately after them
const BREAK_AFTER: Record<Day, number[]> = {
  Monday: [4, 7],
  Tuesday: [4],
  Wednesday: [4, 7],
  Thursday: [4, 7],
  Friday: [4],
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function slotKey(day: Day, schoolClass: SchoolClass, period: number): string {
  return `${day}-${schoolClass}-${period}`;
}

function isTeacherFreeAt(timetable: Timetable, teacherId: string, day: Day, period: number): boolean {
  for (const cls of CLASSES) {
    const slot = timetable.get(slotKey(day, cls, period));
    if (!slot || slot.status !== "occupied") continue;
    if (slot.teacherId === teacherId) return false;
    if (slot.slashPairTeacherId === teacherId) return false;
    if (slot.slashThirdTeacherId === teacherId) return false;
  }
  return true;
}

function isTeacherUnavailable(teacher: Teacher, day: Day, period: number): boolean {
  const blocked = teacher.unavailable[day];
  return blocked ? blocked.includes(period) : false;
}

function wouldExceedFatigue(
  timetable: Timetable,
  teacherId: string,
  day: Day,
  proposedPeriods: number[],
  fatigueLimit: number,
  // Optional per-teacher override. When provided (number), it wins over
  // the global fatigueLimit. `null`/`undefined` keeps the global limit.
  teacherMaxOverride?: number | null
): boolean {
  const limit =
    typeof teacherMaxOverride === "number" ? teacherMaxOverride : fatigueLimit;
  const periodsToday = PERIODS_PER_DAY[day];
  const breaks = BREAK_AFTER[day];
  const teaching = new Set<number>(proposedPeriods);
  for (let p = 1; p <= periodsToday; p++) {
    for (const cls of CLASSES) {
      const slot = timetable.get(slotKey(day, cls, p));
      if (!slot || slot.status !== "occupied") continue;
      if (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId || slot.slashThirdTeacherId === teacherId) {
        teaching.add(p);
        break;
      }
    }
  }
  let maxConsecutive = 0;
  let current = 0;
  for (let p = 1; p <= periodsToday; p++) {
    if (teaching.has(p)) {
      current++;
      maxConsecutive = Math.max(maxConsecutive, current);
    } else {
      current = 0;
    }
    if (breaks.includes(p)) current = 0;
  }
  return maxConsecutive > limit;
}

// Convenience wrapper: look up the teacher's override by id from a list.
function wouldExceedFatigueForTeacher(
  timetable: Timetable,
  teachers: Teacher[],
  teacherId: string,
  day: Day,
  proposedPeriods: number[],
  fatigueLimit: number,
): boolean {
  const t = teachers.find((x) => x.id === teacherId);
  return wouldExceedFatigue(
    timetable,
    teacherId,
    day,
    proposedPeriods,
    fatigueLimit,
    t?.maxConsecutivePeriods ?? null,
  );
}

function subjectAlreadyTodayForClass(timetable: Timetable, cls: SchoolClass, day: Day, subject: string): boolean {
  const periodsToday = PERIODS_PER_DAY[day];
  for (let p = 1; p <= periodsToday; p++) {
    const slot = timetable.get(slotKey(day, cls, p));
    if (slot?.slotType === "activity") continue;
    if (slot?.status === "occupied" && slot.subject === subject) return true;
    if (slot?.status === "occupied" && slot.slashPairSubject === subject) return true;
    if (slot?.status === "occupied" && slot.slashThirdSubject === subject) return true;
  }
  return false;
}

function teacherCanTeachSubjectToClass(teacher: Teacher, subject: string, cls: SchoolClass): boolean {
  if (!teacher.subjects.includes(subject)) return false;
  if (!teacher.classes.includes(cls)) return false;
  const subjectClasses = teacher.subjectClasses?.[subject];
  if (subjectClasses && subjectClasses.length > 0) return subjectClasses.includes(cls);
  return true;
}

function canAssignDistinctTeachers(teacherLists: Teacher[][]): boolean {
  const assign = (index: number, used: Set<string>): boolean => {
    if (index >= teacherLists.length) return true;
    for (const teacher of teacherLists[index]) {
      if (used.has(teacher.id)) continue;
      used.add(teacher.id);
      if (assign(index + 1, used)) return true;
      used.delete(teacher.id);
    }
    return false;
  };
  return assign(0, new Set<string>());
}

// A timetable can only be generated when every required subject has at least
// one eligible teacher. Slash groups additionally need a different teacher
// for every subject in the group because they run at the same time.
function getGenerationBlockers(
  teachers: Teacher[],
  quotas: SubjectQuota[],
  subjects: Subject[],
  settings: UserSettings,
): string[] {
  const blockers: string[] = [];
  const checkedSlashGroups = new Set<string>();

  for (const cls of CLASSES) {
    for (const quota of quotas) {
      if (getQuotaForClass(quota, cls) <= 0) continue;
      const needed = getQuotaForClass(quota, cls);
      const group = findSlashGroup(subjects, quota.subject, cls);

      if (group.length >= 2) {
        const names = group.map((subject) => subject.name).sort();
        const groupKey = `${cls}:${names.join("|")}`;
        if (checkedSlashGroups.has(groupKey)) continue;
        checkedSlashGroups.add(groupKey);

        const groupQuotas = names.map((name) => {
          const member = quotas.find((item) => item.subject === name);
          return member ? getQuotaForClass(member, cls) : 0;
        });
        if (groupQuotas.some((value) => value !== groupQuotas[0])) {
          blockers.push(`${cls}: slash group ${names.join(" / ")} has different quotas (${groupQuotas.join(" / ")}). Set the same quota for every member or change this class's slash group.`);
        }
        if (groupQuotas[0] > DAYS.length) {
          blockers.push(`${cls}: slash group ${names.join(" / ")} can have at most ${DAYS.length} periods per week.`);
        }

        const teacherLists = names.map((name) =>
          teachers.filter((teacher) => teacherCanTeachSubjectToClass(teacher, name, cls)),
        );
        const missingSubject = names.find((name, index) => teacherLists[index].length === 0);
        if (missingSubject) {
          blockers.push(`${cls}: ${missingSubject} has no eligible teacher. Assign a teacher to both the subject and ${cls}.`);
        } else if (!canAssignDistinctTeachers(teacherLists)) {
          blockers.push(`${cls}: slash group ${names.join(" / ")} needs a different eligible teacher for each subject.`);
        }
        continue;
      }

      const doubles = getRequiredDoubles(quota, cls);
      if (doubles * 2 > needed) {
        blockers.push(`${cls}: ${quota.subject} requires ${doubles} double blocks but has only ${needed} periods.`);
      }
      if (doubles > 0 && (quota.singleOnly || !settings.allowDoublePeriods)) {
        blockers.push(`${cls}: ${quota.subject} requires doubles, but double periods are disabled.`);
      }
      if ((quota.singleOnly || !settings.allowDoublePeriods) && needed > DAYS.length) {
        blockers.push(`${cls}: ${quota.subject} needs ${needed} periods, but only ${DAYS.length} singles fit in a week. Enable doubles or reduce the quota.`);
      }
      const eligible = teachers.filter((teacher) =>
        teacherCanTeachSubjectToClass(teacher, quota.subject, cls),
      );
      if (eligible.length === 0) {
        blockers.push(`${cls}: ${quota.subject} has no eligible teacher. Assign a teacher to both the subject and ${cls}.`);
      }
    }
  }

  return blockers;
}

function placeSlot(
  timetable: Timetable,
  cls: SchoolClass,
  day: Day,
  period: number,
  subject: string,
  teacherId: string,
  slotType: "single" | "double",
  extraPeriod?: number
): void {
  const slot = timetable.get(slotKey(day, cls, period))!;
  slot.status = "occupied";
  slot.subject = subject;
  slot.teacherId = teacherId;
  slot.slotType = slotType;
  slot.slashPairSubject = null;
  slot.slashPairTeacherId = null;
  slot.slashThirdSubject = null;
  slot.slashThirdTeacherId = null;
  slot.slashThirdSubject = null;
  slot.slashThirdTeacherId = null;
  if (slotType === "double" && extraPeriod !== undefined) {
    const slot2 = timetable.get(slotKey(day, cls, extraPeriod))!;
    slot2.status = "occupied";
    slot2.subject = subject;
    slot2.teacherId = teacherId;
    slot2.slotType = "double";
    slot2.slashPairSubject = null;
    slot2.slashPairTeacherId = null;
    slot2.slashThirdSubject = null;
    slot2.slashThirdTeacherId = null;
  }
}

function tryPlace(
  timetable: Timetable,
  cls: SchoolClass,
  day: Day,
  period: number,
  subject: string,
  teacher: Teacher,
  fatigueLimit: number,
  allowDouble: boolean,
  relaxDailyRule = false,
  singleOnlySubjects?: ReadonlySet<string>,
  allowDoublePeriods = true,
  allowDoubleInP8P9 = true,
): number {
  const slot = timetable.get(slotKey(day, cls, period));
  if (!slot || slot.status !== "empty") return 0;
  if (!relaxDailyRule && subjectAlreadyTodayForClass(timetable, cls, day, subject)) return 0;
  if (isTeacherUnavailable(teacher, day, period)) return 0;
  if (!isTeacherFreeAt(timetable, teacher.id, day, period)) return 0;

  // Try double first — never for subjects marked single-periods-only.
  const canDouble =
    allowDouble &&
    allowDoublePeriods &&
    !singleOnlySubjects?.has(subject) &&
    (allowDoubleInP8P9 || period !== 8);
  if (canDouble && period < PERIODS_PER_DAY[day] && !wouldCrossBreak(day, period)) {
    const next = period + 1;
    const slot2 = timetable.get(slotKey(day, cls, next));
    if (
      slot2?.status === "empty" &&
      !isTeacherUnavailable(teacher, day, next) &&
      isTeacherFreeAt(timetable, teacher.id, day, next) &&
      !wouldExceedFatigue(timetable, teacher.id, day, [period, next], fatigueLimit, teacher.maxConsecutivePeriods ?? null)
    ) {
      placeSlot(timetable, cls, day, period, subject, teacher.id, "double", next);
      return 2;
    }
  }

  // Single
  if (!wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit, teacher.maxConsecutivePeriods ?? null)) {
    placeSlot(timetable, cls, day, period, subject, teacher.id, "single");
    return 1;
  }
  return 0;
}

function tryPlaceStrictDouble(
  timetable: Timetable,
  cls: SchoolClass,
  day: Day,
  period: number,
  subject: string,
  teacher: Teacher,
  fatigueLimit: number,
  singleOnlySubjects: ReadonlySet<string>,
  allowDoublePeriods: boolean,
  allowDoubleInP8P9: boolean,
): number {
  if (!allowDoublePeriods || singleOnlySubjects.has(subject)) return 0;
  if (!allowDoubleInP8P9 && period === 8) return 0;
  if (period >= PERIODS_PER_DAY[day] || wouldCrossBreak(day, period)) return 0;
  if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) return 0;

  const slot1 = timetable.get(slotKey(day, cls, period));
  const slot2 = timetable.get(slotKey(day, cls, period + 1));
  if (!slot1 || !slot2 || slot1.status !== "empty" || slot2.status !== "empty") return 0;
  if (isTeacherUnavailable(teacher, day, period) || isTeacherUnavailable(teacher, day, period + 1)) return 0;
  if (!isTeacherFreeAt(timetable, teacher.id, day, period) || !isTeacherFreeAt(timetable, teacher.id, day, period + 1)) return 0;
  if (wouldExceedFatigue(
    timetable, teacher.id, day, [period, period + 1], fatigueLimit, teacher.maxConsecutivePeriods ?? null,
  )) return 0;

  placeSlot(timetable, cls, day, period, subject, teacher.id, "double", period + 1);
  return 2;
}

function scheduleSubject(
  timetable: Timetable,
  cls: SchoolClass,
  subject: string,
  needed: number,
  teachers: Teacher[],
  fatigueLimit: number,
  warnings: string[],
  flaggedIds: Set<string>,
  relaxDailyRule = false
): number {
  const eligible = teachers.filter(t => teacherCanTeachSubjectToClass(t, subject, cls));
  if (eligible.length === 0) {
    warnings.push(`No teacher for ${subject} → ${cls}`);
    return 0;
  }
  let placed = 0;
  const days = shuffle([...DAYS] as Day[]);
  for (const day of days) {
    if (placed >= needed) break;
    const periods = shuffle(Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1));
    for (const period of periods) {
      if (placed >= needed) break;
      const remainingNeeded = needed - placed;
      // Load-balancing: sort eligible teachers by current load (lightest first).
      // For flagged-vs-flagged ties, prefer teachers already teaching today
      // (compresses their week).
      const sortedEligible = sortEligibleByLoadAndDay(eligible, timetable, day, flaggedIds);
      for (const teacher of sortedEligible) {
        const result = tryPlace(
          timetable, cls, day, period, subject, teacher,
          fatigueLimit, remainingNeeded >= 2, relaxDailyRule
        );
        if (result > 0) { placed += result; break; }
      }
    }
  }
  return placed;
}

function scheduleSlashGroup(
  timetable: Timetable,
  cls: SchoolClass,
  groupSubjects: string[],
  needed: number,
  teachers: Teacher[],
  fatigueLimit: number,
  warnings: string[]
): number {
  if (groupSubjects.length < 2 || groupSubjects.length > 3) return 0;
  const teacherLists = groupSubjects.map((subject) =>
    teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, cls))
  );
  for (let i = 0; i < groupSubjects.length; i++) {
    if (teacherLists[i].length === 0) {
      warnings.push(`No teacher for slash subject ${groupSubjects[i]} → ${cls}`);
      return 0;
    }
  }

  let placed = 0;
  const pickTeachers = (
    index: number,
    day: Day,
    period: number,
    chosen: Teacher[],
  ): Teacher[] | null => {
    if (index >= teacherLists.length) return chosen;
    for (const teacher of shuffle(teacherLists[index])) {
      if (chosen.some((t) => t.id === teacher.id)) continue;
      if (isTeacherUnavailable(teacher, day, period)) continue;
      if (!isTeacherFreeAt(timetable, teacher.id, day, period)) continue;
      if (wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit, teacher.maxConsecutivePeriods ?? null)) continue;
      const result = pickTeachers(index + 1, day, period, [...chosen, teacher]);
      if (result) return result;
    }
    return null;
  };

  for (const day of shuffle([...DAYS] as Day[])) {
    if (placed >= needed) break;
    if (groupSubjects.some((subject) => subjectAlreadyTodayForClass(timetable, cls, day, subject))) continue;
    const periods = shuffle(Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1));
    for (const period of periods) {
      if (placed >= needed) break;
      const slot = timetable.get(slotKey(day, cls, period));
      if (!slot || slot.status !== "empty") continue;
      const chosen = pickTeachers(0, day, period, []);
      if (!chosen) continue;
      slot.status = "occupied";
      slot.subject = groupSubjects[0];
      slot.teacherId = chosen[0].id;
      slot.slotType = "slash";
      slot.slashPairSubject = groupSubjects[1] ?? null;
      slot.slashPairTeacherId = chosen[1]?.id ?? null;
      slot.slashThirdSubject = groupSubjects[2] ?? null;
      slot.slashThirdTeacherId = chosen[2]?.id ?? null;
      placed++;
      // A subject/slash group may occur only once per class per day.
      break;
    }
  }
  return placed;
}

function countEmpty(timetable: Timetable): number {
  let count = 0;
  for (const slot of Array.from(timetable.values())) {
    if (slot.status === "empty") count++;
  }
  return count;
}

function countPlacements(timetable: Timetable, cls: SchoolClass, subject: string): number {
  let count = 0;
  for (const slot of Array.from(timetable.values())) {
    if (slot.schoolClass !== cls || slot.status !== "occupied" || slot.slotType === "activity") continue;
    if (slot.subject === subject) count++;
    if (slot.slashPairSubject === subject) count++;
    if (slot.slashThirdSubject === subject) count++;
  }
  return count;
}

type CoverageMetrics = {
  zeroRequiredSubjects: string[];
  missingPeriods: number;
};

function getCoverageMetrics(timetable: Timetable, quotas: SubjectQuota[]): CoverageMetrics {
  const zeroRequiredSubjects: string[] = [];
  let missingPeriods = 0;
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      if (needed <= 0) continue;
      const placed = countPlacements(timetable, cls, quota.subject);
      if (placed === 0) zeroRequiredSubjects.push(`${cls}:${quota.subject}`);
      if (placed < needed) missingPeriods += needed - placed;
    }
  }
  return { zeroRequiredSubjects, missingPeriods };
}

function countDoubleBlocks(timetable: Timetable, cls: SchoolClass, subject: string): number {
  let blocks = 0;
  for (const day of DAYS) {
    for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
      const slot = timetable.get(slotKey(day, cls, p));
      if (!slot || slot.status !== "occupied" || slot.slotType !== "double" || slot.subject !== subject) continue;
      const next = timetable.get(slotKey(day, cls, p + 1));
      if (wouldCrossBreak(day, p) || next?.status !== "occupied" || next.slotType !== "double" ||
          next.subject !== subject || next.teacherId !== slot.teacherId) continue;
      blocks++;
      p++;
    }
  }
  return blocks;
}

function getRequiredDoubleDeficit(timetable: Timetable, quotas: SubjectQuota[], subjects: Subject[]): number {
  let deficit = 0;
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      if (getQuotaForClass(quota, cls) <= 0) continue;
      const required = getRequiredDoubles(quota, cls);
      if (required <= 0) continue;
      if (findSlashGroup(subjects, quota.subject, cls).length >= 2) continue;
      const actual = countDoubleBlocks(timetable, cls, quota.subject);
      deficit += Math.max(0, required - actual);
    }
  }
  return deficit;
}

// Validate the final plan, including preserved lessons. A partial allocation
// must never replace the user's current timetable with a "success" result.
export function validateGeneratedTimetable(
  timetable: Timetable,
  teachers: Teacher[],
  quotas: SubjectQuota[],
  subjects: Subject[],
  settings: UserSettings,
): string[] {
  const errors = new Set<string>();
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher]));
  const teacherSlots = new Map<string, SchoolClass>();
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      const actual = countPlacements(timetable, cls, quota.subject);
      if (actual !== needed) {
        errors.add(`${cls}: ${quota.subject} has ${actual}/${needed} periods${actual > needed ? " (over quota; check preserved lessons)" : ""}.`);
      }
      if (needed > 0 && findSlashGroup(subjects, quota.subject, cls).length < 2) {
        const doubles = countDoubleBlocks(timetable, cls, quota.subject);
        const required = getRequiredDoubles(quota, cls);
        if (doubles < required) errors.add(`${cls}: ${quota.subject} has ${doubles}/${required} required double blocks.`);
      }
      for (const day of DAYS) {
        const slots = Array.from(timetable.values()).filter((slot) =>
          slot.schoolClass === cls && slot.day === day && slot.status === "occupied" && slot.slotType !== "activity" &&
          [slot.subject, slot.slashPairSubject, slot.slashThirdSubject].includes(quota.subject),
        );
        if (slots.length > 1 && (slots.length !== 2 || slots.some((slot) => slot.slotType !== "double") ||
            Math.abs(slots[0].period - slots[1].period) !== 1 || slots[0].teacherId !== slots[1].teacherId)) {
          errors.add(`${cls}: ${quota.subject} repeats outside a double block on ${day}.`);
        }
      }
    }
  }
  for (const slot of Array.from(timetable.values())) {
    if (slot.status !== "occupied" || slot.slotType === "activity") continue;
    const label = `${slot.schoolClass}, ${slot.day} P${slot.period}`;
    const members = [
      { subject: slot.subject, teacherId: slot.teacherId },
      { subject: slot.slashPairSubject, teacherId: slot.slashPairTeacherId },
      { subject: slot.slashThirdSubject, teacherId: slot.slashThirdTeacherId },
    ].filter((member) => member.subject);
    const group = findSlashGroup(subjects, slot.subject ?? "", slot.schoolClass);
    if (slot.slotType === "slash" || group.length >= 2) {
      const actual = members.map((member) => member.subject).sort().join("|");
      if (slot.slotType !== "slash" || group.length < 2 || actual !== group.map((member) => member.name).sort().join("|")) {
        errors.add(`${label}: the lesson does not match this class's slash group. Update or unlock the preserved lesson.`);
      }
    } else if (members.length !== 1) {
      errors.add(`${label}: a regular lesson must have exactly one subject.`);
    }
    if (slot.slotType === "double") {
      const partner = [slot.period - 1, slot.period + 1].find((period) => {
        const other = timetable.get(slotKey(slot.day, slot.schoolClass, period));
        return other?.status === "occupied" && other.slotType === "double" &&
          other.subject === slot.subject && other.teacherId === slot.teacherId &&
          !wouldCrossBreak(slot.day, Math.min(slot.period, period));
      });
      if (partner === undefined) errors.add(`${label}: ${slot.subject} has an incomplete double block.`);
      if (!settings.allowDoublePeriods || quotas.find((quota) => quota.subject === slot.subject)?.singleOnly ||
          (!settings.allowDoubleInP8P9 && (slot.period === 8 || slot.period === 9))) {
        errors.add(`${label}: this double block is disabled by the current settings.`);
      }
    }
    for (const member of members) {
      const teacher = teacherById.get(member.teacherId ?? "");
      if (!quotas.some((quota) => quota.subject === member.subject)) errors.add(`${label}: ${member.subject} has no subject quota.`);
      if (!teacher || !teacherCanTeachSubjectToClass(teacher, member.subject!, slot.schoolClass)) {
        errors.add(`${label}: no eligible teacher is assigned to ${member.subject}.`);
        continue;
      }
      if (isTeacherUnavailable(teacher, slot.day, slot.period)) errors.add(`${label}: ${teacher.name} is unavailable.`);
      const key = `${slot.day}:${slot.period}:${teacher.id}`;
      const otherClass = teacherSlots.get(key);
      if (otherClass) errors.add(`${label}: ${teacher.name} is already teaching ${otherClass} in this period.`);
      teacherSlots.set(key, slot.schoolClass);
    }
  }
  for (const teacher of teachers) {
    for (const day of DAYS) {
      if (wouldExceedFatigue(timetable, teacher.id, day, [], settings.fatigueLimit, teacher.maxConsecutivePeriods ?? null)) {
        errors.add(`${teacher.name} exceeds the consecutive-period limit on ${day}.`);
      }
    }
  }
  return Array.from(errors);
}

function countTeacherLoad(timetable: Timetable, teacherId: string): number {
  let count = 0;
  for (const slot of Array.from(timetable.values())) {
    if (slot.status === "occupied" && (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId || slot.slashThirdTeacherId === teacherId)) {
      count++;
    }
  }
  return count;
}

// ===== Day-off-aware scheduling helpers =====
// A teacher is "flagged" (eligible for day-off consolidation) when they have
// at least one entry in their `unavailable` map. Non-flagged teachers behave
// exactly as before — their ranking is unaffected by day-off considerations.
function buildFlaggedTeacherIds(teachers: Teacher[]): Set<string> {
  const set = new Set<string>();
  for (const t of teachers) {
    const u = t.unavailable;
    if (!u) continue;
    for (const day of DAYS) {
      const arr = u[day];
      if (arr && arr.length > 0) { set.add(t.id); break; }
    }
  }
  return set;
}

function teacherTeachesOnDay(timetable: Timetable, teacherId: string, day: Day): boolean {
  for (const cls of CLASSES) {
    for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
      const slot = timetable.get(slotKey(day, cls, p));
      if (!slot || slot.status !== "occupied") continue;
      if (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId || slot.slashThirdTeacherId === teacherId) return true;
    }
  }
  return false;
}

function countDistinctTeachingDays(timetable: Timetable, teacherId: string): number {
  let n = 0;
  for (const day of DAYS) if (teacherTeachesOnDay(timetable, teacherId, day)) n++;
  return n;
}

// Sort eligible teachers by current load (lightest first), preserving the
// previous tie-breaker (random) for non-flagged teachers. When BOTH compared
// teachers are flagged, prefer the one already teaching on `day` (compresses
// their week) and then prefer fewer distinct teaching days so far.
function sortEligibleByLoadAndDay(
  eligible: Teacher[],
  timetable: Timetable,
  day: Day,
  flaggedIds: Set<string>,
): Teacher[] {
  const annotated = shuffle([...eligible]).map((t) => {
    const flagged = flaggedIds.has(t.id);
    return {
      teacher: t,
      load: countTeacherLoad(timetable, t.id),
      flagged,
      teachesToday: flagged ? teacherTeachesOnDay(timetable, t.id, day) : false,
      distinctDays: flagged ? countDistinctTeachingDays(timetable, t.id) : 0,
    };
  });
  annotated.sort((a, b) => {
    if (a.load !== b.load) return a.load - b.load;
    if (a.flagged && b.flagged) {
      if (a.teachesToday !== b.teachesToday) return a.teachesToday ? -1 : 1;
      if (a.distinctDays !== b.distinctDays) return a.distinctDays - b.distinctDays;
    }
    return 0;
  });
  return annotated.map((x) => x.teacher);
}

function countFlaggedTeachersWithDayOff(timetable: Timetable, flaggedIds: Set<string>): number {
  let n = 0;
  for (const id of Array.from(flaggedIds)) {
    let hasOff = false;
    for (const day of DAYS) {
      if (!teacherTeachesOnDay(timetable, id, day)) { hasOff = true; break; }
    }
    if (hasOff) n++;
  }
  return n;
}

function removeExcess(timetable: Timetable, cls: SchoolClass, subject: string, excess: number, lockedSlots: Timetable): void {
  const toRemove: string[] = [];
  for (const day of [...DAYS].reverse() as Day[]) {
    for (let p = PERIODS_PER_DAY[day]; p >= 1; p--) {
      const key = slotKey(day, cls, p);
      if (lockedSlots.has(key)) continue; // never remove locked slots
      const slot = timetable.get(key);
      if (!slot || slot.status !== "occupied") continue;
      if (slot.slotType === "slash") continue; // do not break slash pairings
      if (slot.subject === subject || slot.slashPairSubject === subject || slot.slashThirdSubject === subject) toRemove.push(key);
    }
  }
  let removed = 0;
  for (const key of toRemove) {
    if (removed >= excess) break;
    const slot = timetable.get(key)!;
    if (slot.slotType === "double") {
      const partner = [slot.period - 1, slot.period + 1]
        .map((period) => timetable.get(slotKey(slot.day, cls, period)))
        .find((other) => other?.status === "occupied" && other.slotType === "double" &&
          other.subject === subject && other.teacherId === slot.teacherId &&
          !wouldCrossBreak(slot.day, Math.min(slot.period, other.period)));
      if (partner && lockedSlots.has(slotKey(partner.day, cls, partner.period))) continue;
      if (partner) partner.slotType = "single";
    }
    slot.status = "empty";
    slot.subject = null;
    slot.teacherId = null;
    slot.slotType = null;
    slot.slashPairSubject = null;
    slot.slashPairTeacherId = null;
    slot.slashThirdSubject = null;
    slot.slashThirdTeacherId = null;
    slot.slashThirdSubject = null;
    slot.slashThirdTeacherId = null;
    removed++;
  }
}

function swapRepairPass(
  timetable: Timetable,
  cls: SchoolClass,
  subject: string,
  teacher: Teacher,
  fatigueLimit: number,
  allTeachers: Teacher[],
  lockedSlots: Timetable
): number {
  for (const day of shuffle([...DAYS] as Day[])) {
    if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) continue;
    for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
      const targetKey = slotKey(day, cls, p);
      if (lockedSlots.has(targetKey)) continue; // never disturb locked slots
      const targetSlot = timetable.get(targetKey);
      if (!targetSlot || targetSlot.status !== "occupied") continue;
      if (targetSlot.slotType === "slash" || targetSlot.slotType === "double") continue;
      const existingSubject = targetSlot.subject!;
      const existingTeacherId = targetSlot.teacherId!;
      const existingTeacher = allTeachers.find(t => t.id === existingTeacherId);
      if (!existingTeacher) continue;
      for (const altDay of shuffle([...DAYS] as Day[])) {
        if (altDay === day) continue;
        if (subjectAlreadyTodayForClass(timetable, cls, altDay, existingSubject)) continue;
        for (let altP = 1; altP <= PERIODS_PER_DAY[altDay]; altP++) {
          const altKey = slotKey(altDay, cls, altP);
          const altSlot = timetable.get(altKey);
          if (!altSlot || altSlot.status !== "empty") continue;
          // Existing teacher must be available + free + fatigue-safe at the new period.
          if (isTeacherUnavailable(existingTeacher, altDay, altP)) continue;
          if (!isTeacherFreeAt(timetable, existingTeacherId, altDay, altP)) continue;
          const savedStatus: TimetableSlot["status"] = targetSlot.status;
          const savedSubject: TimetableSlot["subject"] = targetSlot.subject;
          const savedTeacherId: TimetableSlot["teacherId"] = targetSlot.teacherId;
          const savedSlotType: TimetableSlot["slotType"] = targetSlot.slotType;
          targetSlot.status = "empty";
          targetSlot.subject = null;
          targetSlot.teacherId = null;
          targetSlot.slotType = null;
          const existingFatigueOk = !wouldExceedFatigue(timetable, existingTeacherId, altDay, [altP], fatigueLimit, existingTeacher.maxConsecutivePeriods ?? null);
          const canPlace =
            existingFatigueOk &&
            !isTeacherUnavailable(teacher, day, p) &&
            isTeacherFreeAt(timetable, teacher.id, day, p) &&
            !wouldExceedFatigue(timetable, teacher.id, day, [p], fatigueLimit, teacher.maxConsecutivePeriods ?? null);
          if (canPlace) {
            altSlot.status = "occupied";
            altSlot.subject = existingSubject;
            altSlot.teacherId = existingTeacherId;
            altSlot.slotType = "single";
            altSlot.slashPairSubject = null;
            altSlot.slashPairTeacherId = null;
            altSlot.slashThirdSubject = null;
            altSlot.slashThirdTeacherId = null;
            targetSlot.status = "occupied";
            targetSlot.subject = subject;
            targetSlot.teacherId = teacher.id;
            targetSlot.slotType = "single";
            targetSlot.slashPairSubject = null;
            targetSlot.slashPairTeacherId = null;
            targetSlot.slashThirdSubject = null;
            targetSlot.slashThirdTeacherId = null;
            return 1;
          } else {
            targetSlot.status = savedStatus;
            targetSlot.subject = savedSubject;
            targetSlot.teacherId = savedTeacherId;
            targetSlot.slotType = savedSlotType;
          }
        }
      }
    }
  }
  return 0;
}

function preValidate(
  teachers: Teacher[],
  quotas: SubjectQuota[],
  subjects: Subject[],
  warnings: string[],
  allowDoublePeriods: boolean,
): void {
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      if (needed === 0) continue;
      const requiredDoubles = getRequiredDoubles(quota, cls);
      if (quota.singleOnly && needed > DAYS.length) {
        warnings.push(`PRE-VALIDATE: ${quota.subject} → ${cls} is single-only with quota ${needed}; at most ${DAYS.length} periods fit under the once-per-day rule`);
      }
      if (requiredDoubles * 2 > needed) {
        warnings.push(`PRE-VALIDATE: ${quota.subject} → ${cls} requests ${requiredDoubles} double block(s) but quota ${needed} is too small`);
      }
      if (requiredDoubles > 0 && (!allowDoublePeriods || quota.singleOnly)) {
        warnings.push(`PRE-VALIDATE: ${quota.subject} → ${cls} requires doubles but doubles are disabled for this configuration`);
      }
      if (findSlashGroup(subjects, quota.subject, cls).length >= 2 && needed > DAYS.length) {
        warnings.push(`PRE-VALIDATE: Slash subject ${quota.subject} → ${cls} needs ${needed}/week but slash groups can occur at most once per day (${DAYS.length}/week)`);
      }
      const eligible = teachers.filter(t => teacherCanTeachSubjectToClass(t, quota.subject, cls));
      if (eligible.length === 0) {
        warnings.push(`PRE-VALIDATE: No teacher for "${quota.subject}" → ${cls} (needs ${needed}/week)`);
        continue;
      }
      const maxPlaceable = eligible.reduce((best, t) => {
        let avail = 0;
        for (const day of DAYS) {
          for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
            if (!isTeacherUnavailable(t, day, p)) avail++;
          }
        }
        return Math.max(best, avail);
      }, 0);
      if (maxPlaceable < needed) {
        warnings.push(`PRE-VALIDATE: "${quota.subject}" → ${cls} needs ${needed} periods but best teacher only has ${maxPlaceable} available slots`);
      }
    }
  }
}

function initTimetable(lockedSlots: Timetable): Timetable {
  const timetable: Timetable = new Map();
  for (const cls of CLASSES) {
    for (const day of DAYS) {
      for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
        const key = slotKey(day, cls, p);
        if (lockedSlots.has(key)) {
          timetable.set(key, { ...lockedSlots.get(key)! });
        } else {
          timetable.set(key, {
            day, period: p, schoolClass: cls,
            status: "empty",
            subject: null, teacherId: null,
            slotType: null,
            slashPairSubject: null, slashPairTeacherId: null,
            slashThirdSubject: null, slashThirdTeacherId: null,
            isLocked: false,
          });
        }
      }
    }
  }
  return timetable;
}

function totalPeriodsForClass(): number {
  let total = 0;
  for (const day of DAYS) total += PERIODS_PER_DAY[day];
  return total;
}

function countOccupiedForClass(timetable: Timetable, cls: SchoolClass): number {
  let count = 0;
  for (const day of DAYS) {
    for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
      const slot = timetable.get(slotKey(day, cls, p));
      if (slot?.status === "occupied") count++;
    }
  }
  return count;
}

function countEmptyForClass(timetable: Timetable, cls: SchoolClass): number {
  return totalPeriodsForClass() - countOccupiedForClass(timetable, cls);
}

function countEmptyForClassOnDay(timetable: Timetable, cls: SchoolClass, day: Day): number {
  let count = 0;
  for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
    const slot = timetable.get(slotKey(day, cls, p));
    if (!slot || slot.status === "empty") count++;
  }
  return count;
}

type FreePeriodMetrics = { dailyExcess: number; weeklyExcess: number };
function getFreePeriodMetrics(
  timetable: Timetable,
  freePeriodsPerClass: Record<string, number>,
  defaultMaxFreePerWeek: number,
  maxFreePeriodsPerDay: number,
): FreePeriodMetrics {
  let dailyExcess = 0;
  let weeklyExcess = 0;
  for (const cls of CLASSES) {
    const weeklyFree = countEmptyForClass(timetable, cls);
    const weeklyCap = getMaxFreeForClass(cls, freePeriodsPerClass, defaultMaxFreePerWeek);
    weeklyExcess += Math.max(0, weeklyFree - weeklyCap);
    for (const day of DAYS) {
      dailyExcess += Math.max(0, countEmptyForClassOnDay(timetable, cls, day) - maxFreePeriodsPerDay);
    }
  }
  return { dailyExcess, weeklyExcess };
}

function countEmptyP1(timetable: Timetable): number {
  let count = 0;
  for (const day of DAYS) {
    for (const cls of CLASSES) {
      const slot = timetable.get(slotKey(day, cls, 1));
      if (!slot || slot.status === "empty") count++;
    }
  }
  return count;
}

function maxClassEmpty(timetable: Timetable): number {
  let max = 0;
  for (const cls of CLASSES) {
    max = Math.max(max, countEmptyForClass(timetable, cls));
  }
  return max;
}

// Try to place ONE period of `subject` in `cls` somewhere it fits.
// Returns periods placed (0, 1, or 2 if a double was placed).
// ===== Per-class-level scheduling preferences =====
type ClassLevel = "jss1" | "jss2" | "jss3" | "ss1" | "ss2" | "ss3";
function classLevel(cls: SchoolClass): ClassLevel {
  if (cls === "JSS1") return "jss1";
  if (cls === "JSS2") return "jss2";
  if (cls === "JSS3") return "jss3";
  if (cls === "SS1") return "ss1";
  if (cls === "SS2") return "ss2";
  return "ss3";
}
function getPreferredPeriods(quota: SubjectQuota, cls: SchoolClass): number[] {
  const level = classLevel(cls);
  const specific = quota.preferredPeriods?.[level];
  if (specific !== undefined) return specific;
  if (cls.startsWith("JSS")) return quota.preferredPeriods?.jss ?? [];
  if (cls === "SS2" || cls === "SS3") return quota.preferredPeriods?.ss2ss3 ?? [];
  return [];
}
function getRequiredDoubles(quota: SubjectQuota, cls: SchoolClass): number {
  const level = classLevel(cls);
  const specific = quota.requiredDoubles?.[level];
  if (specific !== undefined) return specific;
  if (cls.startsWith("JSS")) return quota.requiredDoubles?.jss ?? 0;
  if (cls === "SS2" || cls === "SS3") return quota.requiredDoubles?.ss2ss3 ?? 0;
  return 0;
}
// Returns periods sorted so preferred ones come first (each group internally
// shuffled for variety across attempts).
function periodsByPreference(allPeriods: number[], preferred: number[]): number[] {
  if (preferred.length === 0) return shuffle(allPeriods);
  const prefSet = new Set(preferred);
  const pref: number[] = [];
  const rest: number[] = [];
  for (const p of allPeriods) (prefSet.has(p) ? pref : rest).push(p);
  return [...shuffle(pref), ...shuffle(rest)];
}

function daysByFreeNeed(
  timetable: Timetable,
  cls: SchoolClass,
  maxFreePeriodsPerDay: number,
): Day[] {
  const days = shuffle([...DAYS] as Day[]);
  days.sort((a, b) => {
    const ea = countEmptyForClassOnDay(timetable, cls, a);
    const eb = countEmptyForClassOnDay(timetable, cls, b);
    const xa = Math.max(0, ea - maxFreePeriodsPerDay);
    const xb = Math.max(0, eb - maxFreePeriodsPerDay);
    if (xa !== xb) return xb - xa;
    return eb - ea;
  });
  return days;
}

function countAvailableSubjectDays(
  timetable: Timetable, cls: SchoolClass, subject: string, teachers: Teacher[], fatigueLimit: number,
): number {
  const eligible = teachers.filter((teacher) => teacherCanTeachSubjectToClass(teacher, subject, cls));
  return DAYS.filter((day) => {
    if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) return false;
    for (let period = 1; period <= PERIODS_PER_DAY[day]; period++) {
      if (timetable.get(slotKey(day, cls, period))?.status !== "empty") continue;
      if (eligible.some((teacher) => !isTeacherUnavailable(teacher, day, period) &&
          isTeacherFreeAt(timetable, teacher.id, day, period) &&
          !wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit, teacher.maxConsecutivePeriods ?? null))) return true;
    }
    return false;
  }).length;
}

function upgradeSingleToDouble(
  timetable: Timetable, cls: SchoolClass, subject: string, teachers: Teacher[], fatigueLimit: number,
  lockedSlots: Timetable, singleOnlySubjects: ReadonlySet<string>, allowDoublePeriods: boolean, allowDoubleInP8P9: boolean,
): number {
  if (!allowDoublePeriods || singleOnlySubjects.has(subject)) return 0;
  for (const [key, slot] of Array.from(timetable.entries())) {
    if (lockedSlots.has(key) || slot.schoolClass !== cls || slot.subject !== subject ||
        slot.status !== "occupied" || slot.slotType !== "single") continue;
    const teacher = teachers.find((item) => item.id === slot.teacherId);
    if (!teacher || !teacherCanTeachSubjectToClass(teacher, subject, cls)) continue;
    for (const period of [slot.period + 1, slot.period - 1]) {
      const start = Math.min(period, slot.period);
      if (start < 1 || wouldCrossBreak(slot.day, start) || (!allowDoubleInP8P9 && start === 8)) continue;
      const targetKey = slotKey(slot.day, cls, period);
      if (lockedSlots.has(targetKey) || timetable.get(targetKey)?.status !== "empty") continue;
      if (isTeacherUnavailable(teacher, slot.day, period) || !isTeacherFreeAt(timetable, teacher.id, slot.day, period) ||
          wouldExceedFatigue(timetable, teacher.id, slot.day, [period], fatigueLimit, teacher.maxConsecutivePeriods ?? null)) continue;
      placeSlot(timetable, cls, slot.day, start, subject, teacher.id, "double", start + 1);
      return 1;
    }
  }
  return 0;
}

function placeOneSubjectPeriod(
  timetable: Timetable,
  cls: SchoolClass,
  subject: string,
  teachers: Teacher[],
  fatigueLimit: number,
  remainingNeeded: number,
  flaggedIds: Set<string>,
  preferredPeriods: number[] = [],
  singleOnlySubjects?: ReadonlySet<string>,
  maxFreePeriodsPerDay = 2,
  allowDoublePeriods = true,
  allowDoubleInP8P9 = true,
): number {
  const eligible = teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, cls));
  if (eligible.length === 0) return 0;
  for (const day of daysByFreeNeed(timetable, cls, maxFreePeriodsPerDay)) {
    if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) continue;
    const allPeriods = Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1);
    const periods = periodsByPreference(allPeriods, preferredPeriods);
    const sortedEligible = sortEligibleByLoadAndDay(eligible, timetable, day, flaggedIds);
    for (const period of periods) {
      for (const teacher of sortedEligible) {
        const r = tryPlace(
          timetable, cls, day, period, subject, teacher,
          fatigueLimit, remainingNeeded >= 2, false, singleOnlySubjects,
          allowDoublePeriods, allowDoubleInP8P9,
        );
        if (r > 0) return r;
      }
    }
  }
  return 0;
}

// Try to fill a specific (day, cls, period) with any subject that still needs periods.
// If `preferenceMap` is provided, subjects whose preferred-period list contains
// `period` are tried first (within their group, order is still shuffled).
function fillSpecificSlot(
  timetable: Timetable,
  cls: SchoolClass,
  day: Day,
  period: number,
  remainingMap: Map<string, number>,
  teachers: Teacher[],
  fatigueLimit: number,
  flaggedIds: Set<string>,
  preferenceMap?: Map<string, number[]>,
  singleOnlySubjects?: ReadonlySet<string>,
  allowDoublePeriods = true,
  allowDoubleInP8P9 = true,
): boolean {
  const slot = timetable.get(slotKey(day, cls, period));
  if (!slot || slot.status !== "empty") return false;
  const allSubjects = Array.from(remainingMap.keys());
  let subjects: string[];
  if (preferenceMap) {
    const pref: string[] = [];
    const rest: string[] = [];
    for (const s of allSubjects) {
      const p = preferenceMap.get(s);
      if (p && p.includes(period)) pref.push(s);
      else rest.push(s);
    }
    subjects = [...shuffle(pref), ...shuffle(rest)];
  } else {
    subjects = shuffle(allSubjects);
  }
  for (const subject of subjects) {
    if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) continue;
    const eligible = teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, cls));
    if (eligible.length === 0) continue;
    const sortedEligible = sortEligibleByLoadAndDay(eligible, timetable, day, flaggedIds);
    for (const teacher of sortedEligible) {
      const needed = remainingMap.get(subject) ?? 0;
      const preferDouble = needed > countAvailableSubjectDays(timetable, cls, subject, teachers, fatigueLimit);
      const r = tryPlace(
        timetable, cls, day, period, subject, teacher, fatigueLimit, needed >= 2 && preferDouble,
        false, singleOnlySubjects, allowDoublePeriods, allowDoubleInP8P9,
      );
      if (r > 0) {
        const newRem = (remainingMap.get(subject) ?? 0) - r;
        if (newRem <= 0) remainingMap.delete(subject);
        else remainingMap.set(subject, newRem);
        return true;
      }
    }
  }
  return false;
}

// The earlier generation phases can remove an over-quota placement or move a
// class during rebalancing. Re-check coverage at the end so a newly free slot
// is used for a missing subject instead of leaving its eligible teacher idle.
function repairFinalCoverage(
  timetable: Timetable,
  teachers: Teacher[],
  quotas: SubjectQuota[],
  subjects: Subject[],
  fatigueLimit: number,
  flaggedIds: Set<string>,
  singleOnlySubjects: ReadonlySet<string>,
  maxFreePeriodsPerDay: number,
  allowDoublePeriods: boolean,
  allowDoubleInP8P9: boolean,
  warnings: string[],
  lockedSlots: Timetable,
): number {
  let repaired = 0;

  for (const cls of CLASSES) {
    const handledSlashGroups = new Set<string>();

    for (const quota of quotas) {
      const group = findSlashGroup(subjects, quota.subject, cls);
      if (group.length >= 2) {
        const names = group.map((subject) => subject.name).sort();
        const key = `${cls}:${names.join("|")}`;
        if (handledSlashGroups.has(key)) continue;
        handledSlashGroups.add(key);

        const groupQuota = quotas.find((item) => item.subject === names[0]);
        const needed = groupQuota ? getQuotaForClass(groupQuota, cls) : 0;
        const placed = Math.max(...names.map((name) => countPlacements(timetable, cls, name)));
        let missing = needed - placed;
        while (missing > 0) {
          const added = scheduleSlashGroup(timetable, cls, names, 1, teachers, fatigueLimit, warnings);
          if (added === 0) break;
          repaired += added;
          missing -= added;
        }
        continue;
      }

      const needed = getQuotaForClass(quota, cls);
      if (needed <= 0) continue;
      let missing = needed - countPlacements(timetable, cls, quota.subject);
      while (missing > 0) {
        const added = placeOneSubjectPeriod(
          timetable,
          cls,
          quota.subject,
          teachers,
          fatigueLimit,
          missing,
          flaggedIds,
          getPreferredPeriods(quota, cls),
          singleOnlySubjects,
          maxFreePeriodsPerDay,
          allowDoublePeriods,
          allowDoubleInP8P9,
        ) || upgradeSingleToDouble(
          timetable, cls, quota.subject, teachers, fatigueLimit, lockedSlots,
          singleOnlySubjects, allowDoublePeriods, allowDoubleInP8P9,
        );
        if (added === 0) break;
        repaired += added;
        missing -= added;
      }

      // A full quota can still consist of singles where doubles are required.
      // Move an unlocked single into an adjacent period of another lesson,
      // preserving the exact weekly count and all teacher constraints.
      const required = getRequiredDoubles(quota, cls);
      while (countDoubleBlocks(timetable, cls, quota.subject) < required) {
        const atQuota = countPlacements(timetable, cls, quota.subject) >= needed;
        const donors = atQuota
          ? Array.from(timetable.entries()).filter(([key, slot]) => !lockedSlots.has(key) &&
              slot.schoolClass === cls && slot.subject === quota.subject && slot.status === "occupied" && slot.slotType === "single")
          : [["", undefined] as const];
        let upgraded = false;
        for (const [key, donor] of donors) {
          const saved = donor ? { ...donor } : undefined;
          if (donor) Object.assign(donor, { status: "empty", subject: null, teacherId: null, slotType: null });
          const added = upgradeSingleToDouble(
            timetable, cls, quota.subject, teachers, fatigueLimit, lockedSlots,
            singleOnlySubjects, allowDoublePeriods, allowDoubleInP8P9,
          );
          if (added > 0) {
            repaired += saved ? 0 : added;
            upgraded = true;
            break;
          }
          if (saved) timetable.set(key, saved);
        }
        if (!upgraded) break;
      }
    }
  }

  return repaired;
}

// Period-1 swap repair: if P1 of (day, cls) is empty, try to move a same-day
// later occupied (single) period of the same class into P1, preserving all rules.
function p1SwapRepair(
  timetable: Timetable,
  teachers: Teacher[],
  fatigueLimit: number,
  lockedSlots: Timetable,
): number {
  let repaired = 0;
  for (const day of DAYS) {
    for (const cls of CLASSES) {
      const p1Key = slotKey(day, cls, 1);
      if (lockedSlots.has(p1Key)) continue;
      const p1Slot = timetable.get(p1Key);
      if (!p1Slot || p1Slot.status !== "empty") continue;

      const candidates = shuffle(
        Array.from({ length: PERIODS_PER_DAY[day] - 1 }, (_, i) => i + 2),
      );
      for (const p of candidates) {
        const sourceKey = slotKey(day, cls, p);
        if (lockedSlots.has(sourceKey)) continue;
        const sourceSlot = timetable.get(sourceKey);
        if (!sourceSlot || sourceSlot.status !== "occupied") continue;
        if (sourceSlot.slotType !== "single") continue;
        const teacherId = sourceSlot.teacherId!;
        const teacher = teachers.find((t) => t.id === teacherId);
        if (!teacher) continue;
        if (isTeacherUnavailable(teacher, day, 1)) continue;

        const savedSubject = sourceSlot.subject!;
        // Temporarily empty source so checks reflect the post-swap world.
        sourceSlot.status = "empty";
        sourceSlot.subject = null;
        sourceSlot.teacherId = null;
        sourceSlot.slotType = null;

        const teacherFreeAtP1 = isTeacherFreeAt(timetable, teacherId, day, 1);
        const fatigueOk = !wouldExceedFatigue(timetable, teacherId, day, [1], fatigueLimit, teacher.maxConsecutivePeriods ?? null);

        if (teacherFreeAtP1 && fatigueOk) {
          p1Slot.status = "occupied";
          p1Slot.subject = savedSubject;
          p1Slot.teacherId = teacherId;
          p1Slot.slotType = "single";
          p1Slot.slashPairSubject = null;
          p1Slot.slashPairTeacherId = null;
          repaired++;
          break;
        }
        // Restore on failure.
        sourceSlot.status = "occupied";
        sourceSlot.subject = savedSubject;
        sourceSlot.teacherId = teacherId;
        sourceSlot.slotType = "single";
      }
    }
  }
  return repaired;
}

function getMaxFreeForClass(
  cls: SchoolClass,
  freePeriodsPerClass: Record<string, number>,
  defaultMax: number,
): number {
  const v = freePeriodsPerClass[cls];
  return typeof v === "number" ? v : defaultMax;
}

// Cross-class rebalancer ----------------------------------------------------
//
// Once the main scheduler has done all it can, the worst case is that one
// class (e.g. SS2) ends up with several empty slots while the other classes
// are completely filled. That happens when the only eligible teacher for a
// missing subject is permanently busy in another class. This pass actively
// redistributes those empties: for every empty slot in the worst class, it
// looks for a placement in another class that, if removed (and ideally
// re-routed elsewhere), would free up an eligible teacher to fill the
// worst-class slot. It only applies a move that strictly improves the
// max-class-empty count, so the global "fairness" score monotonically
// improves and the loop is guaranteed to terminate.
function isMovableSlot(slot: TimetableSlot | undefined): boolean {
  if (!slot || slot.status !== "occupied") return false;
  if (slot.slotType !== "single") return false;
  return true;
}

// Returns the alt slot key on success (caller must remember it for rollback),
// or null if no relocation possible (in which case the source slot is restored).
function relocatePlacementToEmpty(
  timetable: Timetable,
  fromCls: SchoolClass,
  fromDay: Day,
  fromPeriod: number,
  teachers: Teacher[],
  fatigueLimit: number,
  lockedSlots: Timetable,
  blockedKey: string,
): string | null {
  const sourceKey = slotKey(fromDay, fromCls, fromPeriod);
  const sourceSlot = timetable.get(sourceKey);
  if (!isMovableSlot(sourceSlot)) return null;
  const subject = sourceSlot!.subject!;
  const originalTeacherId = sourceSlot!.teacherId!;

  // Temporarily empty the source so checks reflect the post-move world.
  sourceSlot!.status = "empty";
  sourceSlot!.subject = null;
  sourceSlot!.teacherId = null;
  sourceSlot!.slotType = null;

  const eligible = shuffle(
    teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, fromCls)),
  );

  for (const altDay of shuffle([...DAYS] as Day[])) {
    if (subjectAlreadyTodayForClass(timetable, fromCls, altDay, subject)) continue;
    for (const altP of shuffle(Array.from({ length: PERIODS_PER_DAY[altDay] }, (_, i) => i + 1))) {
      const altKey = slotKey(altDay, fromCls, altP);
      if (altKey === blockedKey) continue;
      if (altKey === sourceKey) continue;
      if (lockedSlots.has(altKey)) continue;
      const altSlot = timetable.get(altKey);
      if (!altSlot || altSlot.status !== "empty") continue;
      for (const t of eligible) {
        if (isTeacherUnavailable(t, altDay, altP)) continue;
        if (!isTeacherFreeAt(timetable, t.id, altDay, altP)) continue;
        if (wouldExceedFatigue(timetable, t.id, altDay, [altP], fatigueLimit, t.maxConsecutivePeriods ?? null)) continue;
        altSlot.status = "occupied";
        altSlot.subject = subject;
        altSlot.teacherId = t.id;
        altSlot.slotType = "single";
        altSlot.slashPairSubject = null;
        altSlot.slashPairTeacherId = null;
        altSlot.slashThirdSubject = null;
        altSlot.slashThirdTeacherId = null;
        return altKey;
      }
    }
  }

  // Restore — couldn't relocate.
  sourceSlot!.status = "occupied";
  sourceSlot!.subject = subject;
  sourceSlot!.teacherId = originalTeacherId;
  sourceSlot!.slotType = "single";
  return null;
}

// Undo a successful relocation: clear the alt slot and re-occupy the source
// with the original (subject, teacher, single).
function undoRelocate(
  timetable: Timetable,
  sourceKey: string,
  altKey: string,
  originalSubject: string,
  originalTeacherId: string,
): void {
  const altSlot = timetable.get(altKey);
  if (altSlot) {
    altSlot.status = "empty";
    altSlot.subject = null;
    altSlot.teacherId = null;
    altSlot.slotType = null;
    altSlot.slashPairSubject = null;
    altSlot.slashPairTeacherId = null;
    altSlot.slashThirdSubject = null;
    altSlot.slashThirdTeacherId = null;
  }
  const sourceSlot = timetable.get(sourceKey);
  if (sourceSlot) {
    sourceSlot.status = "occupied";
    sourceSlot.subject = originalSubject;
    sourceSlot.teacherId = originalTeacherId;
    sourceSlot.slotType = "single";
    sourceSlot.slashPairSubject = null;
    sourceSlot.slashPairTeacherId = null;
  }
}

function tryRebalanceFromWorst(
  worstCls: SchoolClass,
  emptyByClass: Map<SchoolClass, number>,
  timetable: Timetable,
  teachers: Teacher[],
  quotas: SubjectQuota[],
  subjects: Subject[],
  fatigueLimit: number,
  lockedSlots: Timetable,
  freePeriodsPerClass: Record<string, number>,
  defaultMaxFreePerWeek: number,
): boolean {
  const worstEmpty = emptyByClass.get(worstCls)!;

  // Subjects worstCls would still benefit from (placed < quota and has eligible teacher).
  const wantedSubjects: Array<{ subject: string; eligibleIds: Set<string> }> = [];
  for (const q of quotas) {
    const needed = getQuotaForClass(q, worstCls);
    if (needed === 0) continue;
    if (findSlashGroup(subjects, q.subject, worstCls).length >= 2) continue;
    const placed = countPlacements(timetable, worstCls, q.subject);
    if (placed >= needed) continue;
    const eligible = teachers.filter((t) => teacherCanTeachSubjectToClass(t, q.subject, worstCls));
    if (eligible.length === 0) continue;
    wantedSubjects.push({ subject: q.subject, eligibleIds: new Set(eligible.map((t) => t.id)) });
  }
  if (wantedSubjects.length === 0) return false;

  // Iterate every empty (day, period) of worstCls and try to free up a teacher.
  for (const day of shuffle([...DAYS] as Day[])) {
    for (const period of shuffle(Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1))) {
      const targetKey = slotKey(day, worstCls, period);
      if (lockedSlots.has(targetKey)) continue;
      const targetSlot = timetable.get(targetKey);
      if (!targetSlot || targetSlot.status !== "empty") continue;

      for (const { subject, eligibleIds } of shuffle(wantedSubjects)) {
        if (subjectAlreadyTodayForClass(timetable, worstCls, day, subject)) continue;

        // Find a class C2 (!= worstCls) where, at (day, period), one of the
        // eligible teachers for (worstCls, subject) is currently occupied.
        for (const c2 of shuffle(CLASSES.filter((c) => c !== worstCls))) {
          const c2Key = slotKey(day, c2, period);
          if (lockedSlots.has(c2Key)) continue;
          const c2Slot = timetable.get(c2Key);
          if (!isMovableSlot(c2Slot)) continue;
          const c2TeacherId = c2Slot!.teacherId!;
          if (!eligibleIds.has(c2TeacherId)) continue;
          // The teacher must also be unavailability-free at this slot, which
          // they obviously are (they're already teaching it). Good.

          // Compute prospective max-class-empty if we either RELOCATE c2's
          // slot (preserves c2's empty count) or DROP c2's slot (c2 +1 empty).
          //
          // We only proceed if a strict improvement to the worst-class empty
          // count is achievable.
          const c2Empty = emptyByClass.get(c2)!;
          const c2Cap = getMaxFreeForClass(c2, freePeriodsPerClass, defaultMaxFreePerWeek);

          // First try a RELOCATE: move c2's slot to a different (altDay, altP)
          // where another (or the same) eligible teacher for (c2, S2) is free.
          // This is the ideal case — total empties unchanged.
          const c2OriginalSubject = c2Slot!.subject!;
          const c2OriginalTeacherId = c2Slot!.teacherId!;
          const c2SourceKey = c2Key;
          const relocatedAltKey = relocatePlacementToEmpty(
            timetable, c2, day, period, teachers, fatigueLimit, lockedSlots,
            targetKey, // do NOT relocate into the slot we're trying to fill
          );

          if (relocatedAltKey) {
            // c2Slot is now empty (by relocate). Place worstCls's subject here.
            const eligibleTeachers = shuffle(
              teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, worstCls)),
            );
            let placedOk = false;
            for (const t of eligibleTeachers) {
              const placed = tryPlace(
                timetable, worstCls, day, period, subject, t,
                fatigueLimit, false, false,
              );
              if (placed > 0) { placedOk = true; break; }
            }
            if (placedOk) return true;
            // Final placement failed — undo the relocate so the timetable is
            // exactly as it was before this attempted move.
            undoRelocate(
              timetable, c2SourceKey, relocatedAltKey,
              c2OriginalSubject, c2OriginalTeacherId,
            );
            continue;
          }

          // RELOCATE failed. Fall back to DROP only when the donor subject
          // is genuinely above its configured quota. Fairness must never
          // create a new subject shortage (especially a zero-occurrence one).
          const donorQuota = quotas.find((q) => q.subject === c2OriginalSubject);
          const donorNeeded = donorQuota ? getQuotaForClass(donorQuota, c2) : 0;
          const donorPlaced = countPlacements(timetable, c2, c2OriginalSubject);
          if (donorNeeded > 0 && donorPlaced <= donorNeeded) continue;

          // Only do this if it strictly improves the max-class-empty score.
          const newWorstEmpty = worstEmpty - 1;
          const newC2Empty = c2Empty + 1;
          if (newC2Empty > c2Cap) continue; // would push c2 over its free-period cap
          // After the move, the worst-class-empty across all classes becomes:
          // max(newWorstEmpty, newC2Empty, max(others)).
          let othersMax = 0;
          for (const c of CLASSES) {
            if (c === worstCls || c === c2) continue;
            const e = emptyByClass.get(c)!;
            if (e > othersMax) othersMax = e;
          }
          const newMax = Math.max(newWorstEmpty, newC2Empty, othersMax);
          if (newMax >= worstEmpty) continue; // no fairness improvement

          // Apply the drop. Save originals so we can restore on failure.
          const savedC2Subject = c2Slot!.subject!;
          c2Slot!.status = "empty";
          c2Slot!.subject = null;
          c2Slot!.teacherId = null;
          c2Slot!.slotType = null;
          c2Slot!.slashPairSubject = null;
          c2Slot!.slashPairTeacherId = null;

          // Place worstCls subject in the freed slot using the same teacher.
          const teacherObj = teachers.find((t) => t.id === c2TeacherId)!;
          const placed = tryPlace(
            timetable, worstCls, day, period, subject, teacherObj,
            fatigueLimit, false, false,
          );
          if (placed > 0) return true;

          // Couldn't place — restore c2's slot.
          c2Slot!.status = "occupied";
          c2Slot!.subject = savedC2Subject;
          c2Slot!.teacherId = c2TeacherId;
          c2Slot!.slotType = "single";
        }
      }
    }
  }
  return false;
}

function crossClassRebalance(
  timetable: Timetable,
  teachers: Teacher[],
  quotas: SubjectQuota[],
  subjects: Subject[],
  fatigueLimit: number,
  lockedSlots: Timetable,
  freePeriodsPerClass: Record<string, number>,
  defaultMaxFreePerWeek: number,
): number {
  const MAX_REBALANCE_ITERS = 80;
  let movesApplied = 0;
  for (let iter = 0; iter < MAX_REBALANCE_ITERS; iter++) {
    const emptyByClass = new Map<SchoolClass, number>();
    for (const cls of CLASSES) emptyByClass.set(cls, countEmptyForClass(timetable, cls));

    let worstCls: SchoolClass | null = null;
    let worstEmpty = -1;
    let minEmpty = Infinity;
    for (const cls of CLASSES) {
      const e = emptyByClass.get(cls)!;
      if (e > worstEmpty) { worstEmpty = e; worstCls = cls; }
      if (e < minEmpty) minEmpty = e;
    }
    if (!worstCls || worstEmpty === 0) break;
    if (worstEmpty - minEmpty <= 1) break; // already balanced

    const moved = tryRebalanceFromWorst(
      worstCls, emptyByClass,
      timetable, teachers, quotas, subjects, fatigueLimit, lockedSlots,
      freePeriodsPerClass, defaultMaxFreePerWeek,
    );
    if (!moved) break;
    movesApplied++;
  }
  return movesApplied;
}

// Day-off consolidation: for each flagged teacher (those with at least one
// `unavailable` entry), if they have a single non-empty teaching day with
// only 1-2 periods, try to relocate those periods to other days where they
// already teach so the teacher gains a fully empty day. All existing rules
// (clash, fatigue, daily-occurrence, breaks, locked, slash) are honoured.
function consolidateTeacherDays(
  timetable: Timetable,
  flaggedIds: Set<string>,
  teachers: Teacher[],
  fatigueLimit: number,
  lockedSlots: Timetable,
): number {
  let moves = 0;
  for (const teacher of teachers) {
    if (!flaggedIds.has(teacher.id)) continue;

    // Group teacher's current periods by day.
    type SlotRef = { key: string; day: Day; cls: SchoolClass; period: number; subject: string };
    const byDay = new Map<Day, SlotRef[]>();
    for (const day of DAYS) {
      for (const cls of CLASSES) {
        for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
          const key = slotKey(day, cls, p);
          const slot = timetable.get(key);
          if (!slot || slot.status !== "occupied") continue;
          if (
            slot.teacherId !== teacher.id &&
            slot.slashPairTeacherId !== teacher.id &&
            slot.slashThirdTeacherId !== teacher.id
          ) continue;
          if (!byDay.has(day)) byDay.set(day, []);
          byDay.get(day)!.push({ key, day, cls, period: p, subject: slot.subject ?? "" });
        }
      }
    }
    if (byDay.size === 0) continue;
    // Skip if the teacher already has a fully empty day.
    if (byDay.size < DAYS.length) continue;

    // Pick the lightest non-empty day with 1 or 2 periods (cheapest to move).
    const sorted = Array.from(byDay.entries()).sort((a, b) => a[1].length - b[1].length);
    const [lightDay, lightSlots] = sorted[0];
    if (lightSlots.length === 0 || lightSlots.length > 2) continue;

    // Refuse to touch locked or slash slots — those moves are out of scope.
    if (lightSlots.some((s) => lockedSlots.has(s.key))) continue;
    const slotsRaw = lightSlots.map((s) => timetable.get(s.key)!);
    if (slotsRaw.some((s) => s.slotType !== "single")) continue;

    // Plan a relocation for each period on the light day. We apply each move
    // immediately so subsequent candidate checks (notably fatigue and clash)
    // see the prior planned placements. If any source can't be relocated we
    // revert every applied move atomically — leaving the timetable unchanged.
    type Move = {
      fromKey: string;
      toKey: string;
      subject: string;
      cls: SchoolClass;
      fromSnapshot: TimetableSlot;
      toSnapshot: TimetableSlot;
    };
    const applied: Move[] = [];
    let allOk = true;

    const revert = () => {
      for (let i = applied.length - 1; i >= 0; i--) {
        const m = applied[i];
        const fromSlot = timetable.get(m.fromKey)!;
        const toSlot = timetable.get(m.toKey)!;
        Object.assign(fromSlot, m.fromSnapshot);
        Object.assign(toSlot, m.toSnapshot);
      }
    };

    for (const src of lightSlots) {
      let placed = false;
      const otherDays = shuffle(DAYS.filter((d) => d !== lightDay) as Day[]);
      outer: for (const day of otherDays) {
        // Daily-occurrence rule: subject can't already be on this day for cls.
        if (subjectAlreadyTodayForClass(timetable, src.cls, day, src.subject)) continue;
        const periods = shuffle(Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1));
        for (const period of periods) {
          const targetKey = slotKey(day, src.cls, period);
          if (lockedSlots.has(targetKey)) continue;
          const target = timetable.get(targetKey);
          if (!target || target.status !== "empty") continue;
          if (isTeacherUnavailable(teacher, day, period)) continue;
          if (!isTeacherFreeAt(timetable, teacher.id, day, period)) continue;
          if (wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit, teacher.maxConsecutivePeriods ?? null)) continue;
          // Snapshot, then apply this move. Subsequent moves' fatigue/clash
          // checks will now include this placement.
          const fromSlot = timetable.get(src.key)!;
          const fromSnapshot: TimetableSlot = { ...fromSlot };
          const toSnapshot: TimetableSlot = { ...target };
          target.status = "occupied";
          target.subject = src.subject;
          target.teacherId = teacher.id;
          target.slotType = "single";
          target.slashPairSubject = null;
          target.slashPairTeacherId = null;
          fromSlot.status = "empty";
          fromSlot.subject = null;
          fromSlot.teacherId = null;
          fromSlot.slotType = null;
          fromSlot.slashPairSubject = null;
          fromSlot.slashPairTeacherId = null;
          applied.push({
            fromKey: src.key, toKey: targetKey,
            subject: src.subject, cls: src.cls,
            fromSnapshot, toSnapshot,
          });
          placed = true;
          break outer;
        }
      }
      if (!placed) { allOk = false; break; }
    }
    if (!allOk || applied.length === 0) {
      revert();
      continue;
    }
    moves++;
  }
  return moves;
}

function runAttempt(
  teachers: Teacher[],
  quotas: SubjectQuota[],
  subjects: Subject[],
  lockedSlots: Timetable,
  fatigueLimit: number,
  attemptNumber: number,
  freePeriodsPerClass: Record<string, number>,
  defaultMaxFreePerWeek: number,
  maxFreePeriodsPerDay: number,
  allowDoublePeriods: boolean,
  allowDoubleInP8P9: boolean,
  flaggedIds: Set<string>,
): { timetable: Timetable; emptyCount: number; warnings: string[] } {
  const timetable = initTimetable(lockedSlots);
  const warnings: string[] = [];

  // PHASE 1: User-defined 2- or 3-subject slash groups (SS2/SS3).
  for (const cls of ["SS2", "SS3"] as SchoolClass[]) {
    const seenSlashGroups = new Set<string>();
    for (const subj of subjects) {
      const group = findSlashGroup(subjects, subj.name, cls);
      if (group.length < 2) continue;
      const names = group.map((s) => s.name).sort();
      const groupKey = names.join("|");
      if (seenSlashGroups.has(groupKey)) continue;
      seenSlashGroups.add(groupKey);

      const groupQuotas = names.map((name) => {
        const quota = quotas.find((q) => q.subject === name);
        return quota ? getQuotaForClass(quota, cls) : 0;
      });
      const periods = groupQuotas[0];
      if (periods <= 0) continue;
      // Each member consumes one period in the same slot. Existing lessons
      // count toward the quota, including lessons preserved for this run.
      const existing = Math.max(...names.map((name) => countPlacements(timetable, cls, name)));
      const missing = Math.max(0, periods - existing);
      scheduleSlashGroup(timetable, cls, names, missing, teachers, fatigueLimit, warnings);
    }
  }

  // PHASE 2: Build per-class remaining-needed map.
  const remainingByClass = new Map<SchoolClass, Map<string, number>>();
  for (const cls of CLASSES) {
    const sub = new Map<string, number>();
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      if (needed === 0) continue;
      if (findSlashGroup(subjects, quota.subject, cls).length >= 2) continue;
      const eligible = teachers.filter((t) => teacherCanTeachSubjectToClass(t, quota.subject, cls));
      if (eligible.length === 0) continue;
      const alreadyPlaced = countPlacements(timetable, cls, quota.subject);
      const remaining = needed - alreadyPlaced;
      if (remaining > 0) sub.set(quota.subject, remaining);
    }
    remainingByClass.set(cls, sub);
  }

  // Build per-class subject -> preferred-periods map (used for P1 priority and elsewhere).
  const preferenceByClass = new Map<SchoolClass, Map<string, number[]>>();
  for (const cls of CLASSES) {
    const m = new Map<string, number[]>();
    for (const quota of quotas) {
      const pref = getPreferredPeriods(quota, cls);
      if (pref.length > 0) m.set(quota.subject, pref);
    }
    preferenceByClass.set(cls, m);
  }

  // Subjects flagged single-periods-only: never scheduled as doubles.
  const singleOnlySubjects: ReadonlySet<string> = new Set(
    quotas.filter((q) => q.singleOnly).map((q) => q.subject),
  );

  // PHASE 2A: Required doubles pre-pass — for each (cls, subject), place the
  // user-requested number of double-period blocks before single-period scheduling.
  // Doubles try preferred periods first; if none fit, any legal slot is used.
  for (const cls of shuffle([...CLASSES] as SchoolClass[])) {
    const remaining = remainingByClass.get(cls)!;
    const subjectsForClass = shuffle(quotas.map((q) => q.subject));
    for (const subject of subjectsForClass) {
      const quota = quotas.find((q) => q.subject === subject);
      if (!quota) continue;
      if (findSlashGroup(subjects, quota.subject, cls).length >= 2) continue;
      const wantDoubles = getRequiredDoubles(quota, cls);
      if (wantDoubles <= 0) continue;
      if (!allowDoublePeriods || singleOnlySubjects.has(subject)) {
        warnings.push(`Attempt ${attemptNumber}: ${subject} → ${cls}: required doubles cannot be placed because doubles are disabled`);
        continue;
      }
      const eligible = teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, cls));
      if (eligible.length === 0) continue;
      const pref = getPreferredPeriods(quota, cls);
      let placedDoubles = countDoubleBlocks(timetable, cls, subject);
      for (const day of daysByFreeNeed(timetable, cls, maxFreePeriodsPerDay)) {
        if (placedDoubles >= wantDoubles) break;
        if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) continue;
        const remNeeded = remaining.get(subject) ?? 0;
        if (remNeeded < 2) break;
        const allPeriods = Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1);
        const periods = periodsByPreference(allPeriods, pref);
        const sortedEligible = sortEligibleByLoadAndDay(eligible, timetable, day, flaggedIds);
        let placedThisDay = false;
        for (const period of periods) {
          if (placedThisDay) break;
          for (const teacher of sortedEligible) {
            const r = tryPlaceStrictDouble(
              timetable, cls, day, period, subject, teacher, fatigueLimit,
              singleOnlySubjects, allowDoublePeriods, allowDoubleInP8P9,
            );
            if (r === 2) {
              const newRem = remNeeded - 2;
              if (newRem <= 0) remaining.delete(subject);
              else remaining.set(subject, newRem);
              placedDoubles++;
              placedThisDay = true;
              break;
            }
          }
        }
      }
      // Report any remaining shortfall after the repair passes, so a repaired
      // requirement does not leave a stale warning in a successful result.
    }
  }

  // PHASE 2B: First-occurrence guarantee. Every subject with quota > 0
  // gets a chance to receive a legal lesson before optional repeats are
  // filled. Use a double when the remaining teaching days need one. Subjects
  // with the fewest eligible teachers are attempted first. Senior slash groups
  // were handled atomically in Phase 1 and must never be split here.
  for (const cls of shuffle([...CLASSES] as SchoolClass[])) {
    const remaining = remainingByClass.get(cls)!;
    const candidates = quotas
      .filter((quota) => {
        if (getQuotaForClass(quota, cls) <= 0) return false;
        if (findSlashGroup(subjects, quota.subject, cls).length >= 2) return false;
        if (countPlacements(timetable, cls, quota.subject) > 0) return false;
        return (remaining.get(quota.subject) ?? 0) > 0;
      })
      .map((quota) => ({
        quota,
        eligibleCount: teachers.filter((t) =>
          teacherCanTeachSubjectToClass(t, quota.subject, cls),
        ).length,
      }));

    // Shuffle first so subjects with equal constraint levels do not always
    // receive the same deterministic ordering across attempts.
    const ordered = shuffle(candidates).sort((a, b) => a.eligibleCount - b.eligibleCount);
    for (const { quota } of ordered) {
      const subject = quota.subject;
      const remNeeded = remaining.get(subject) ?? 0;
      if (remNeeded <= 0 || countPlacements(timetable, cls, subject) > 0) continue;
      const placed = placeOneSubjectPeriod(
        timetable, cls, subject, teachers, fatigueLimit,
        remNeeded > countAvailableSubjectDays(timetable, cls, subject, teachers, fatigueLimit) ? Math.min(2, remNeeded) : 1,
        flaggedIds, getPreferredPeriods(quota, cls), singleOnlySubjects,
        maxFreePeriodsPerDay, allowDoublePeriods, allowDoubleInP8P9,
      );
      if (placed > 0) {
        const newRem = remNeeded - placed;
        if (newRem <= 0) remaining.delete(subject);
        else remaining.set(subject, newRem);
      }
    }
  }

  // PHASE 3: Period-1 priority pass — fill P1 of every (day, cls) first.
  for (const day of shuffle([...DAYS] as Day[])) {
    for (const cls of shuffle([...CLASSES] as SchoolClass[])) {
      const p1Key = slotKey(day, cls, 1);
      if (lockedSlots.has(p1Key)) continue;
      const p1Slot = timetable.get(p1Key);
      if (!p1Slot || p1Slot.status !== "empty") continue;
      const remaining = remainingByClass.get(cls)!;
      if (remaining.size === 0) continue;
      fillSpecificSlot(
        timetable, cls, day, 1, remaining, teachers, fatigueLimit, flaggedIds,
        preferenceByClass.get(cls), singleOnlySubjects, allowDoublePeriods, allowDoubleInP8P9,
      );
    }
  }

  // PHASE 4: Round-robin placement across classes.
  // Each round: rank classes by (over-cap first, then largest deficit), then
  // place ONE more period in the top-ranked class with remaining work, and
  // recompute. This shares leftover empties across classes instead of dumping
  // them on the last class processed.
  const totalPerClass = totalPeriodsForClass();
  const targetPlacedByClass = new Map<SchoolClass, number>();
  for (const cls of CLASSES) {
    let target = 0;
    const countedSlashGroups = new Set<string>();
    for (const quota of quotas) {
      if (findSlashGroup(subjects, quota.subject, cls).length >= 2) {
        const group = findSlashGroup(subjects, quota.subject, cls);
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

  // Sanity cap on rounds to avoid pathological loops.
  const MAX_ROUNDS = CLASSES.length * 60;
  let rounds = 0;
  while (rounds++ < MAX_ROUNDS) {
    const candidates: Array<{ cls: SchoolClass; deficit: number; over: number }> = [];
    for (const cls of CLASSES) {
      const subMap = remainingByClass.get(cls)!;
      if (subMap.size === 0) continue;
      const placed = countOccupiedForClass(timetable, cls);
      const target = targetPlacedByClass.get(cls)!;
      const deficit = Math.max(0, target - placed);
      if (deficit === 0) continue;
      const empty = totalPerClass - placed;
      const cap = getMaxFreeForClass(cls, freePeriodsPerClass, defaultMaxFreePerWeek);
      const over = Math.max(0, empty - cap);
      candidates.push({ cls, deficit, over });
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => {
      if (a.over !== b.over) return b.over - a.over; // most over-cap first
      return b.deficit - a.deficit; // then most-behind first
    });
    let progressed = false;
    for (const { cls } of candidates) {
      const subMap = remainingByClass.get(cls)!;
      const subjectList = shuffle(Array.from(subMap.keys()));
      for (const subject of subjectList) {
        const remNeeded = subMap.get(subject)!;
        const q = quotas.find((x) => x.subject === subject);
        const pref = q ? getPreferredPeriods(q, cls) : [];
        const placed = placeOneSubjectPeriod(
          timetable, cls, subject, teachers, fatigueLimit, remNeeded, flaggedIds, pref, singleOnlySubjects,
          maxFreePeriodsPerDay, allowDoublePeriods, allowDoubleInP8P9,
        );
        if (placed > 0) {
          const newRem = remNeeded - placed;
          if (newRem <= 0) subMap.delete(subject);
          else subMap.set(subject, newRem);
          progressed = true;
          break;
        }
      }
      if (progressed) break; // fairness — recompute rankings each round
    }
    if (!progressed) break;
  }

  // PHASE 5: Swap repair for subjects still short.
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      if (needed === 0) continue;
      if (findSlashGroup(subjects, quota.subject, cls).length >= 2) continue;
      const alreadyPlaced = countPlacements(timetable, cls, quota.subject);
      if (alreadyPlaced >= needed) continue;
      const eligible = teachers.filter((t) => teacherCanTeachSubjectToClass(t, quota.subject, cls));
      for (const teacher of shuffle(eligible)) {
        const repaired = swapRepairPass(timetable, cls, quota.subject, teacher, fatigueLimit, teachers, lockedSlots);
        if (repaired > 0) break;
      }
    }
  }

  // PHASE 6: Remove excess (over-quota) — never touches locked slots.
  // Done before P1 swap repair so that excess removals (which may empty a P1)
  // are immediately repaired by the swap pass below.
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      const placed = countPlacements(timetable, cls, quota.subject);
      if (placed > needed) removeExcess(timetable, cls, quota.subject, placed - needed, lockedSlots);
    }
  }

  // PHASE 7: Period-1 swap repair — if any P1 is still empty, pull a later
  // single-period from the same (day, class) into P1 when teacher rules allow.
  // Run twice in case the first pass cascades opportunities.
  p1SwapRepair(timetable, teachers, fatigueLimit, lockedSlots);
  p1SwapRepair(timetable, teachers, fatigueLimit, lockedSlots);

  // PHASE 8: Cross-class rebalance — actively redistributes empty periods so
  // they don't all pile up on one class. Only applies moves that strictly
  // improve the max-class-empty count, then re-runs P1 repair in case a swap
  // emptied a P1 slot.
  const rebalanceMoves = crossClassRebalance(
    timetable, teachers, quotas, subjects, fatigueLimit, lockedSlots,
    freePeriodsPerClass, defaultMaxFreePerWeek,
  );
  if (rebalanceMoves > 0) {
    // Re-run excess removal first: a relocate can move a placement into a slot
    // for a class that's already at quota for that subject. Then re-run P1
    // repair in case any P1 ended up empty after a swap.
    for (const cls of CLASSES) {
      for (const quota of quotas) {
        const needed = getQuotaForClass(quota, cls);
        const placed = countPlacements(timetable, cls, quota.subject);
        if (placed > needed) removeExcess(timetable, cls, quota.subject, placed - needed, lockedSlots);
      }
    }
    p1SwapRepair(timetable, teachers, fatigueLimit, lockedSlots);
    p1SwapRepair(timetable, teachers, fatigueLimit, lockedSlots);
  }

  // PHASE 9: Day-off consolidation for flagged teachers (those with at least
  // one `unavailable` entry). Tries to give them a fully empty day by
  // relocating periods from their lightest day to other days they already
  // teach. Only applies moves that satisfy all existing rules.
  if (flaggedIds.size > 0) {
    const consolidationMoves = consolidateTeacherDays(timetable, flaggedIds, teachers, fatigueLimit, lockedSlots);
    if (consolidationMoves > 0) {
      p1SwapRepair(timetable, teachers, fatigueLimit, lockedSlots);
      p1SwapRepair(timetable, teachers, fatigueLimit, lockedSlots);
    }
  }

  // Revisit every required subject after excess removal and class rebalancing.
  // This catches subjects that became placeable only after another subject was
  // removed or moved to a different class.
  const finalCoverageRepairs = repairFinalCoverage(
    timetable,
    teachers,
    quotas,
    subjects,
    fatigueLimit,
    flaggedIds,
    singleOnlySubjects,
    maxFreePeriodsPerDay,
    allowDoublePeriods,
    allowDoubleInP8P9,
    warnings,
    lockedSlots,
  );
  if (finalCoverageRepairs > 0) {
    warnings.push(`Final coverage repair placed ${finalCoverageRepairs} missing period(s).`);
  }

  const finalCoverage = getCoverageMetrics(timetable, quotas);
  if (finalCoverage.zeroRequiredSubjects.length > 0) {
    warnings.push(
      `CRITICAL: Required subject(s) with zero timetable occurrences: ${finalCoverage.zeroRequiredSubjects.join(", ")}`,
    );
  }
  const finalDoubleDeficit = getRequiredDoubleDeficit(timetable, quotas, subjects);
  if (finalDoubleDeficit > 0) {
    warnings.push(`CRITICAL: ${finalDoubleDeficit} required double-period block(s) remain unmet`);
  }
  const finalFreeMetrics = getFreePeriodMetrics(
    timetable, freePeriodsPerClass, defaultMaxFreePerWeek, maxFreePeriodsPerDay,
  );
  if (finalFreeMetrics.weeklyExcess > 0) {
    warnings.push(`CRITICAL: Weekly free-period limits exceeded by ${finalFreeMetrics.weeklyExcess} period(s) across classes`);
  }
  if (finalFreeMetrics.dailyExcess > 0) {
    warnings.push(`CRITICAL: Daily free-period limits exceeded by ${finalFreeMetrics.dailyExcess} period(s) across class-days`);
  }

  // After rebalancing, if any one class is still significantly worse off than
  // the others, surface a single warning so the user understands.
  let finalWorstCls: SchoolClass | null = null;
  let finalWorstEmpty = 0;
  let finalMinEmpty = Infinity;
  for (const cls of CLASSES) {
    const e = countEmptyForClass(timetable, cls);
    if (e > finalWorstEmpty) { finalWorstEmpty = e; finalWorstCls = cls; }
    if (e < finalMinEmpty) finalMinEmpty = e;
  }
  if (finalWorstCls && finalWorstEmpty - finalMinEmpty >= 2) {
    const residual = finalWorstEmpty - finalMinEmpty;
    // Identify the subjects still short on the worst class — those are the
    // ones the user most likely needs more eligible teachers for.
    const shortSubjects: string[] = [];
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, finalWorstCls);
      const placed = countPlacements(timetable, finalWorstCls, quota.subject);
      if (placed < needed) shortSubjects.push(quota.subject);
    }
    const subjectsHint = shortSubjects.length
      ? ` for [${shortSubjects.join(", ")}]`
      : "";
    warnings.push(
      `${finalWorstCls} has ${residual} more empty period(s) than the best-balanced class (${finalWorstEmpty} total empty) — consider adding more eligible teachers${subjectsHint}.`,
    );
  }

  return { timetable, emptyCount: countEmpty(timetable), warnings };
}

const MAX_ATTEMPTS = 12;
const EARLY_EXIT_EMPTY = 3;

export function generateTimetable(
  { teachers, quotas, subjects, userSettings, existingTimetable }: GenerationInput,
  lockExisting = false,
  clearFirst = true,
): GenerationPlan {
  const fatigueLimit = userSettings.fatigueLimit;
  const maxFreePeriodsPerDay = userSettings.maxFreePeriodsPerDay;
  const allowDoublePeriods = userSettings.allowDoublePeriods;
  const allowDoubleInP8P9 = userSettings.allowDoubleInP8P9;

  // Load existing timetable to determine locked slots
  const lockedSlots: Timetable = new Map();

  // Treat existing occupied slots as locked when:
  //   - the user explicitly chose "lock existing", OR
  //   - clearFirst is false (preserve current timetable; only fill empty cells)
  const preserveExisting = lockExisting || !clearFirst;
  if (preserveExisting) {
    for (const [key, slot] of Array.from(existingTimetable.entries())) {
      if (slot.status === "occupied") {
        lockedSlots.set(key, { ...slot });
      }
    }
  }

  // Fixed periods (isLocked = true) and non-teaching activities are ALWAYS
  // locked, regardless of the user's lockExisting / clearFirst choice. Merge
  // them in last so they take precedence over the preserveExisting copies.
  for (const [key, slot] of Array.from(existingTimetable.entries())) {
    if (slot.status === "occupied" && (slot.isLocked || slot.slotType === "activity")) {
      lockedSlots.set(key, { ...slot });
    }
  }

  // Pre-validate: warn about impossible assignments before wasting attempts
  const preWarnings: string[] = [];
  preValidate(teachers, quotas, subjects, preWarnings, allowDoublePeriods);
  const blockers = getGenerationBlockers(teachers, quotas, subjects, userSettings);
  if (blockers.length > 0) {
    return { result: {
      success: false,
      slotsPlaced: 0,
      warnings: preWarnings,
      errors: [
        "Generation was not started. Fix the subject settings or teacher assignments below.",
        ...blockers,
      ],
    } };
  }

  const freePeriodsPerClass = userSettings.freePeriodsPerClass ?? {};
  const defaultMaxFreePerWeek = userSettings.maxFreePeriodsPerWeek;

  // Identify "flagged" teachers (those with at least one `unavailable` entry).
  // Day-off-aware ranking and consolidation only target this subset, so users
  // who never set unavailability see no behaviour change.
  const flaggedIds = buildFlaggedTeacherIds(teachers);

  // Run up to MAX_ATTEMPTS fully in-memory, pick the attempt with the best
  // lexicographic score: (fewest empty P1, fewest worst-class empties, fewest
  // total empties, then most flagged teachers with a fully empty day).
  type AttemptResult = {
    timetable: Timetable;
    emptyCount: number;
    warnings: string[];
    zeroRequiredCount: number;
    missingRequiredPeriods: number;
    requiredDoubleDeficit: number;
    weeklyFreeExcess: number;
    dailyFreeExcess: number;
    emptyP1: number;
    worstClassEmpty: number;
    flaggedDayOff: number;
  };
  let best: AttemptResult | null = null;
  const cmp = (a: AttemptResult, b: AttemptResult): number => {
    // Subject coverage is a hard priority: never prefer a prettier/full-looking
    // timetable that completely omits a required subject.
    if (a.zeroRequiredCount !== b.zeroRequiredCount) return a.zeroRequiredCount - b.zeroRequiredCount;
    if (a.missingRequiredPeriods !== b.missingRequiredPeriods) return a.missingRequiredPeriods - b.missingRequiredPeriods;
    if (a.requiredDoubleDeficit !== b.requiredDoubleDeficit) return a.requiredDoubleDeficit - b.requiredDoubleDeficit;
    if (a.weeklyFreeExcess !== b.weeklyFreeExcess) return a.weeklyFreeExcess - b.weeklyFreeExcess;
    if (a.dailyFreeExcess !== b.dailyFreeExcess) return a.dailyFreeExcess - b.dailyFreeExcess;
    if (a.emptyP1 !== b.emptyP1) return a.emptyP1 - b.emptyP1;
    if (a.worstClassEmpty !== b.worstClassEmpty) return a.worstClassEmpty - b.worstClassEmpty;
    if (a.emptyCount !== b.emptyCount) return a.emptyCount - b.emptyCount;
    return b.flaggedDayOff - a.flaggedDayOff; // more day-offs is better
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const r = runAttempt(
      teachers, quotas, subjects, lockedSlots, fatigueLimit, attempt,
      freePeriodsPerClass, defaultMaxFreePerWeek, maxFreePeriodsPerDay,
      allowDoublePeriods, allowDoubleInP8P9, flaggedIds,
    );
    const coverage = getCoverageMetrics(r.timetable, quotas);
    const freeMetrics = getFreePeriodMetrics(
      r.timetable, freePeriodsPerClass, defaultMaxFreePerWeek, maxFreePeriodsPerDay,
    );
    const scored: AttemptResult = {
      ...r,
      zeroRequiredCount: coverage.zeroRequiredSubjects.length,
      missingRequiredPeriods: coverage.missingPeriods,
      requiredDoubleDeficit: getRequiredDoubleDeficit(r.timetable, quotas, subjects),
      weeklyFreeExcess: freeMetrics.weeklyExcess,
      dailyFreeExcess: freeMetrics.dailyExcess,
      emptyP1: countEmptyP1(r.timetable),
      worstClassEmpty: maxClassEmpty(r.timetable),
      flaggedDayOff: countFlaggedTeachersWithDayOff(r.timetable, flaggedIds),
    };
    if (!best || cmp(scored, best) < 0) {
      best = scored;
    }
    if (
      best.zeroRequiredCount === 0 &&
      best.missingRequiredPeriods === 0 &&
      best.requiredDoubleDeficit === 0 &&
      best.weeklyFreeExcess === 0 &&
      best.dailyFreeExcess === 0 &&
      best.emptyP1 === 0 &&
      best.emptyCount <= EARLY_EXIT_EMPTY
    ) break;
  }

  if (!best) {
    return { result: { success: false, slotsPlaced: 0, warnings: preWarnings, errors: ["Failed to generate timetable"] } };
  }

  const allWarnings = [...preWarnings, ...best.warnings];
  const errors = validateGeneratedTimetable(best.timetable, teachers, quotas, subjects, userSettings);
  if (errors.length > 0) {
    return { result: {
      success: false,
      slotsPlaced: 0,
      warnings: allWarnings,
      errors: ["Generation was not saved. The current timetable has been kept.", ...errors],
    } };
  }

  const slots = Array.from(best.timetable.values()).filter((slot) => slot.status === "occupied");
  const slotsPlaced = slots.filter((slot) =>
    !preserveExisting || !lockedSlots.has(slotKey(slot.day, slot.schoolClass, slot.period)),
  ).length;
  if (best.emptyCount > 0) {
    allWarnings.push(`${best.emptyCount} slot(s) remain empty after ${MAX_ATTEMPTS} attempts`);
  }
  return { slots, result: { success: true, slotsPlaced, warnings: allWarnings, errors: [] } };
}
