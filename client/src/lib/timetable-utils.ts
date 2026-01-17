import {
  DAYS,
  PERIODS_PER_DAY,
  CLASSES,
  BREAK_AFTER_P4,
  BREAK_AFTER_P7,
  MAX_FREE_PERIODS_PER_WEEK,
  MAX_FREE_PERIODS_PER_DAY,
  TOTAL_PERIODS_PER_WEEK,
  MIN_TEACHING_PERIODS_PER_WEEK,
  getSubjectsForClass,
  usesSlashSubjects,
  SLASH_SUBJECTS,
  type Day,
  type SchoolClass,
  type TimetableSlot,
  type Teacher,
  type ValidationResult,
  type ValidationError,
  type PlacementRequest,
  type TeacherWorkload,
  type SubjectPeriodCount,
} from "@shared/schema";

// Generate teacher colors - distinct, accessible colors
export const TEACHER_COLORS = [
  "#3B82F6", // Blue
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#8B5CF6", // Violet
  "#EF4444", // Red
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#84CC16", // Lime
  "#F97316", // Orange
  "#6366F1", // Indigo
  "#14B8A6", // Teal
  "#A855F7", // Purple
  "#22C55E", // Green
  "#FBBF24", // Yellow
  "#0EA5E9", // Sky
];

export function getTeacherColor(index: number): string {
  return TEACHER_COLORS[index % TEACHER_COLORS.length];
}

// Check if a period is a break
export function isBreakPeriod(day: Day, period: number): boolean {
  if (day === "Friday") {
    // Friday has special structure: P1-P3, then prayer/break, then P4-P6
    // We don't mark specific periods as breaks on Friday since it has fewer periods
    return false;
  }
  // Break after P4 (before P5) and after P7 (before P8) for other days
  // We show breaks as separate rows, so individual periods are not breaks
  return false;
}

// Check if a double period would cross a break
export function wouldCrossBreak(day: Day, startPeriod: number): boolean {
  const maxPeriods = PERIODS_PER_DAY[day];
  if (startPeriod >= maxPeriods) return true; // Can't start double at last period
  
  // Break 1 is after P4, so double starting at P4 would cross
  if (startPeriod === BREAK_AFTER_P4) return true;
  
  // Break 2 is after P7 (Mon-Thu only), so double starting at P7 would cross
  if (day !== "Friday" && day !== "Tuesday" && startPeriod === BREAK_AFTER_P7) return true;
  
  return false;
}

// Get periods for a specific day
export function getPeriodsForDay(day: Day): number[] {
  const count = PERIODS_PER_DAY[day];
  return Array.from({ length: count }, (_, i) => i + 1);
}

// Initialize empty timetable
export function initializeTimetable(): Map<string, TimetableSlot> {
  const timetable = new Map<string, TimetableSlot>();
  
  for (const day of DAYS) {
    for (const schoolClass of CLASSES) {
      const periods = getPeriodsForDay(day);
      for (const period of periods) {
        const key = `${day}-${schoolClass}-${period}`;
        timetable.set(key, {
          day,
          period,
          schoolClass,
          status: "empty",
          subject: null,
          teacherId: null,
          slotType: null,
          slashPairSubject: null,
          slashPairTeacherId: null,
        });
      }
    }
  }
  
  return timetable;
}

// Get slot key
export function getSlotKey(day: Day, schoolClass: SchoolClass, period: number): string {
  return `${day}-${schoolClass}-${period}`;
}

// Get slot from timetable
export function getSlot(
  timetable: Map<string, TimetableSlot>,
  day: Day,
  schoolClass: SchoolClass,
  period: number
): TimetableSlot | undefined {
  return timetable.get(getSlotKey(day, schoolClass, period));
}

// Free period tracking types
export interface FreePeriodStats {
  weeklyTotal: number;
  dailyCounts: Record<Day, number>;
  isValid: boolean;
  weeklyExceeded: boolean;
  dailyExceededDays: Day[];
}

// Calculate free periods for a class
export function getFreePeriodStats(
  timetable: Map<string, TimetableSlot>,
  schoolClass: SchoolClass
): FreePeriodStats {
  const dailyCounts: Record<Day, number> = {
    Monday: 0,
    Tuesday: 0,
    Wednesday: 0,
    Thursday: 0,
    Friday: 0,
  };
  
  let weeklyTotal = 0;
  
  for (const day of DAYS) {
    const periods = getPeriodsForDay(day);
    for (const period of periods) {
      const slot = getSlot(timetable, day, schoolClass, period);
      if (!slot || slot.status === "empty") {
        dailyCounts[day]++;
        weeklyTotal++;
      }
    }
  }
  
  const weeklyExceeded = weeklyTotal > MAX_FREE_PERIODS_PER_WEEK;
  const dailyExceededDays = DAYS.filter(day => dailyCounts[day] > MAX_FREE_PERIODS_PER_DAY);
  const isValid = !weeklyExceeded && dailyExceededDays.length === 0;
  
  return {
    weeklyTotal,
    dailyCounts,
    isValid,
    weeklyExceeded,
    dailyExceededDays,
  };
}

// Calculate filled periods for a class
export function getFilledPeriodsCount(
  timetable: Map<string, TimetableSlot>,
  schoolClass: SchoolClass
): number {
  let count = 0;
  for (const day of DAYS) {
    const periods = getPeriodsForDay(day);
    for (const period of periods) {
      const slot = getSlot(timetable, day, schoolClass, period);
      if (slot && slot.status !== "empty") {
        count++;
      }
    }
  }
  return count;
}

// Check if adding a free period would violate limits
export function canAddFreePeriod(
  timetable: Map<string, TimetableSlot>,
  schoolClass: SchoolClass,
  day: Day
): { allowed: boolean; reason?: string } {
  const stats = getFreePeriodStats(timetable, schoolClass);
  
  if (stats.weeklyTotal >= MAX_FREE_PERIODS_PER_WEEK) {
    return { allowed: false, reason: `${schoolClass} already has ${MAX_FREE_PERIODS_PER_WEEK} free periods this week (maximum allowed)` };
  }
  
  if (stats.dailyCounts[day] >= MAX_FREE_PERIODS_PER_DAY) {
    return { allowed: false, reason: `${schoolClass} already has ${MAX_FREE_PERIODS_PER_DAY} free periods on ${day} (maximum allowed)` };
  }
  
  return { allowed: true };
}

// Re-export constants for UI components
export { MAX_FREE_PERIODS_PER_WEEK, MAX_FREE_PERIODS_PER_DAY, TOTAL_PERIODS_PER_WEEK, MIN_TEACHING_PERIODS_PER_WEEK };

// Check if teacher is available (not teaching another class at same time)
export function isTeacherAvailable(
  timetable: Map<string, TimetableSlot>,
  teacher: Teacher,
  day: Day,
  period: number
): boolean {
  // Check if teacher is marked as unavailable for this day/period
  const unavailablePeriods = teacher.unavailable[day] || [];
  if (unavailablePeriods.includes(period)) return false;
  
  // Check if teacher is already teaching another class at this time
  for (const schoolClass of CLASSES) {
    const slot = getSlot(timetable, day, schoolClass, period);
    if (slot && slot.teacherId === teacher.id) return false;
    if (slot && slot.slashPairTeacherId === teacher.id) return false;
  }
  
  return true;
}

// Calculate consecutive teaching periods for a teacher on a given day
export function getConsecutiveTeachingPeriods(
  timetable: Map<string, TimetableSlot>,
  teacherId: string,
  day: Day
): Array<{ start: number; end: number; count: number }> {
  const periods = getPeriodsForDay(day);
  const teachingPeriods: number[] = [];
  
  for (const period of periods) {
    let isTeaching = false;
    for (const schoolClass of CLASSES) {
      const slot = getSlot(timetable, day, schoolClass, period);
      if (slot && (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId)) {
        isTeaching = true;
        break;
      }
    }
    if (isTeaching) {
      teachingPeriods.push(period);
    }
  }
  
  // Group consecutive periods, accounting for breaks
  const groups: Array<{ start: number; end: number; count: number }> = [];
  let currentGroup: number[] = [];
  
  for (const period of teachingPeriods) {
    if (currentGroup.length === 0) {
      currentGroup.push(period);
    } else {
      const lastPeriod = currentGroup[currentGroup.length - 1];
      // Check if there's a break between last and current
      const hasBreakBetween =
        (lastPeriod <= BREAK_AFTER_P4 && period > BREAK_AFTER_P4) ||
        (day !== "Friday" && day !== "Tuesday" && lastPeriod <= BREAK_AFTER_P7 && period > BREAK_AFTER_P7);
      
      if (period === lastPeriod + 1 && !hasBreakBetween) {
        currentGroup.push(period);
      } else {
        groups.push({
          start: currentGroup[0],
          end: currentGroup[currentGroup.length - 1],
          count: currentGroup.length,
        });
        currentGroup = [period];
      }
    }
  }
  
  if (currentGroup.length > 0) {
    groups.push({
      start: currentGroup[0],
      end: currentGroup[currentGroup.length - 1],
      count: currentGroup.length,
    });
  }
  
  return groups;
}

// Check consecutive same subject count for a class on a day
export function getConsecutiveSameSubjectCount(
  timetable: Map<string, TimetableSlot>,
  day: Day,
  schoolClass: SchoolClass,
  subject: string,
  newPeriods: number[]
): number {
  const maxPeriods = PERIODS_PER_DAY[day];
  const subjectPeriods = new Set<number>(newPeriods);
  
  for (let period = 1; period <= maxPeriods; period++) {
    const slot = getSlot(timetable, day, schoolClass, period);
    // Check both subject and slashPairSubject for slash subject handling
    if (slot && (slot.subject === subject || slot.slashPairSubject === subject)) {
      subjectPeriods.add(period);
    }
  }
  
  const sorted = Array.from(subjectPeriods).sort((a, b) => a - b);
  let maxConsecutive = 0;
  let current = 0;
  
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      current = 1;
    } else {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const hasBreak =
        (prev <= BREAK_AFTER_P4 && curr > BREAK_AFTER_P4) ||
        (day !== "Friday" && day !== "Tuesday" && prev <= BREAK_AFTER_P7 && curr > BREAK_AFTER_P7);
      
      if (curr === prev + 1 && !hasBreak) {
        current++;
      } else {
        current = 1;
      }
    }
    maxConsecutive = Math.max(maxConsecutive, current);
  }
  
  return maxConsecutive;
}

// Count total occurrences of a subject for a class on a given day (including slash pairs)
export function getTotalSubjectCountForDay(
  timetable: Map<string, TimetableSlot>,
  day: Day,
  schoolClass: SchoolClass,
  subject: string,
  newPeriods: number[] = []
): number {
  const maxPeriods = PERIODS_PER_DAY[day];
  let count = newPeriods.length;
  
  for (let period = 1; period <= maxPeriods; period++) {
    // Don't double-count if this period is in newPeriods
    if (newPeriods.includes(period)) continue;
    
    const slot = getSlot(timetable, day, schoolClass, period);
    if (slot && (slot.subject === subject || slot.slashPairSubject === subject)) {
      count++;
    }
  }
  
  return count;
}

// Check if adding a period would exceed fatigue limit
export function wouldExceedFatigueLimit(
  timetable: Map<string, TimetableSlot>,
  teacherId: string,
  day: Day,
  period: number,
  isDouble: boolean = false,
  maxConsecutive: number = 5
): boolean {
  const periodsToAdd = isDouble ? [period, period + 1] : [period];
  
  // Create a set of periods the teacher would be teaching
  const periods = getPeriodsForDay(day);
  const teachingPeriods = new Set<number>();
  
  for (const p of periods) {
    for (const schoolClass of CLASSES) {
      const slot = getSlot(timetable, day, schoolClass, p);
      if (slot && (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId)) {
        teachingPeriods.add(p);
        break;
      }
    }
  }
  
  // Add the new periods
  for (const p of periodsToAdd) {
    teachingPeriods.add(p);
  }
  
  // Check for consecutive runs > 5
  const sortedPeriods = Array.from(teachingPeriods).sort((a, b) => a - b);
  let consecutive = 0;
  
  for (let i = 0; i < sortedPeriods.length; i++) {
    if (i === 0) {
      consecutive = 1;
    } else {
      const prevPeriod = sortedPeriods[i - 1];
      const currentPeriod = sortedPeriods[i];
      
      // Check if there's a break between
      const hasBreakBetween =
        (prevPeriod <= BREAK_AFTER_P4 && currentPeriod > BREAK_AFTER_P4) ||
        (day !== "Friday" && day !== "Tuesday" && prevPeriod <= BREAK_AFTER_P7 && currentPeriod > BREAK_AFTER_P7);
      
      if (currentPeriod === prevPeriod + 1 && !hasBreakBetween) {
        consecutive++;
      } else {
        consecutive = 1;
      }
    }
    
    if (consecutive > maxConsecutive) return true;
  }
  
  return false;
}

// Get subject period counts for a class
export function getSubjectPeriodCounts(
  timetable: Map<string, TimetableSlot>,
  schoolClass: SchoolClass
): SubjectPeriodCount[] {
  const requiredSubjects = getSubjectsForClass(schoolClass);
  const counts: Map<string, number> = new Map();
  
  // Count allocated periods
  for (const day of DAYS) {
    const periods = getPeriodsForDay(day);
    for (const period of periods) {
      const slot = getSlot(timetable, day, schoolClass, period);
      if (slot && slot.subject) {
        const current = counts.get(slot.subject) || 0;
        counts.set(slot.subject, current + 1);
        
        // Count slash pair subject too
        if (slot.slashPairSubject) {
          const pairCurrent = counts.get(slot.slashPairSubject) || 0;
          counts.set(slot.slashPairSubject, pairCurrent + 1);
        }
      }
    }
  }
  
  // Build result
  return Object.entries(requiredSubjects).map(([subject, required]) => ({
    schoolClass,
    subject,
    allocated: counts.get(subject) || 0,
    required,
  }));
}

// Validate a placement request
export function validatePlacement(
  timetable: Map<string, TimetableSlot>,
  teachers: Teacher[],
  request: PlacementRequest,
  fatigueLimit: number = 5
): ValidationResult {
  const errors: ValidationError[] = [];
  const { day, period, schoolClass, subject, teacherId, slotType } = request;
  
  const teacher = teachers.find((t) => t.id === teacherId);
  if (!teacher) {
    errors.push({
      code: "TEACHER_NOT_FOUND",
      message: "Teacher not found",
      severity: "error",
    });
    return { isValid: false, errors };
  }
  
  // Check if slot is already occupied
  const slot = getSlot(timetable, day, schoolClass, period);
  if (slot && slot.status === "occupied") {
    errors.push({
      code: "SLOT_OCCUPIED",
      message: `Period ${period} is already occupied`,
      severity: "error",
    });
  }
  
  // Check if teacher is unavailable
  const unavailablePeriods = teacher.unavailable[day] || [];
  if (unavailablePeriods.includes(period)) {
    errors.push({
      code: "TEACHER_UNAVAILABLE",
      message: `${teacher.name} is unavailable during period ${period} on ${day}`,
      severity: "error",
    });
  }
  
  // Check if teacher is already teaching another class
  if (!isTeacherAvailable(timetable, teacher, day, period)) {
    errors.push({
      code: "TEACHER_CLASH",
      message: `${teacher.name} is already teaching another class during period ${period}`,
      severity: "error",
    });
  }
  
  // Check double period specific validations
  if (slotType === "double") {
    const maxPeriods = PERIODS_PER_DAY[day];
    
    // Can't start double at last period
    if (period >= maxPeriods) {
      errors.push({
        code: "INVALID_DOUBLE",
        message: "Cannot start a double period at the last period of the day",
        severity: "error",
      });
    }
    
    // Check P8/P9 restriction
    if (period >= 8) {
      errors.push({
        code: "NO_DOUBLE_P8_P9",
        message: "Double periods are not allowed in P8 or P9",
        severity: "error",
      });
    }
    
    // Check if would cross break
    if (wouldCrossBreak(day, period)) {
      errors.push({
        code: "DOUBLE_CROSSES_BREAK",
        message: "Double period cannot cross a break",
        severity: "error",
      });
    }
    
    // Check if next slot is available
    const nextSlot = getSlot(timetable, day, schoolClass, period + 1);
    if (nextSlot && nextSlot.status === "occupied") {
      errors.push({
        code: "NEXT_SLOT_OCCUPIED",
        message: `Period ${period + 1} is already occupied (needed for double)`,
        severity: "error",
      });
    }
    
    // Check teacher availability for second period
    if (!isTeacherAvailable(timetable, teacher, day, period + 1)) {
      errors.push({
        code: "TEACHER_CLASH_DOUBLE",
        message: `${teacher.name} is not available for period ${period + 1} (needed for double)`,
        severity: "error",
      });
    }
  }
  
  // Check fatigue limit
  if (wouldExceedFatigueLimit(timetable, teacherId, day, period, slotType === "double", fatigueLimit)) {
    errors.push({
      code: "FATIGUE_LIMIT",
      message: `${teacher.name} would exceed ${fatigueLimit} consecutive teaching periods`,
      severity: "error",
    });
  }
  
  // Check if subject already appears on this day (max 1 occurrence per day)
  const dailySubjectCount = getTotalSubjectCountForDay(timetable, day, schoolClass, subject, []);
  if (dailySubjectCount >= 1) {
    errors.push({
      code: "SUBJECT_ALREADY_SCHEDULED",
      message: `${subject} is already scheduled for ${schoolClass} on ${day}`,
      severity: "error",
    });
  }
  
  // For slash subjects, also check the paired subject
  if (request.slashPairSubject) {
    const dailyPairCount = getTotalSubjectCountForDay(timetable, day, schoolClass, request.slashPairSubject, []);
    if (dailyPairCount >= 1) {
      errors.push({
        code: "SUBJECT_ALREADY_SCHEDULED",
        message: `${request.slashPairSubject} is already scheduled for ${schoolClass} on ${day}`,
        severity: "error",
      });
    }
  }
  
  // Check English followed by Security rule
  if (subject === "Security") {
    const prevSlot = getSlot(timetable, day, schoolClass, period - 1);
    if (prevSlot && prevSlot.subject === "English") {
      errors.push({
        code: "ENGLISH_SECURITY",
        message: "Security cannot immediately follow English",
        severity: "error",
      });
    }
  }
  
  // Check weekly period count
  const currentCounts = getSubjectPeriodCounts(timetable, schoolClass);
  const subjectCount = currentCounts.find((c) => c.subject === subject);
  if (subjectCount) {
    const periodsToAdd = slotType === "double" ? 2 : 1;
    if (subjectCount.allocated + periodsToAdd > subjectCount.required) {
      errors.push({
        code: "PERIOD_QUOTA_EXCEEDED",
        message: `${subject} would exceed its weekly quota of ${subjectCount.required} periods`,
        severity: "warning",
      });
    }
  }
  
  // Slash subject validation for SS2/SS3
  if (slotType === "slash" && usesSlashSubjects(schoolClass)) {
    const slashPair = SLASH_SUBJECTS.find(
      (s) => s.pair.includes(subject)
    );
    if (!slashPair) {
      errors.push({
        code: "INVALID_SLASH_SUBJECT",
        message: `${subject} is not a valid slash subject`,
        severity: "error",
      });
    } else {
      // Check if paired subject and teacher are provided
      if (!request.slashPairSubject || !request.slashPairTeacherId) {
        errors.push({
          code: "MISSING_SLASH_PAIR",
          message: "Slash subjects require both subjects and teachers",
          severity: "error",
        });
      }
    }
  }
  
  return {
    isValid: errors.filter((e) => e.severity === "error").length === 0,
    errors,
  };
}

// Calculate teacher workload
export function calculateTeacherWorkload(
  timetable: Map<string, TimetableSlot>,
  teacher: Teacher
): TeacherWorkload {
  let totalPeriods = 0;
  const periodsByDay: Record<Day, number> = {
    Monday: 0,
    Tuesday: 0,
    Wednesday: 0,
    Thursday: 0,
    Friday: 0,
  };
  const consecutiveWarnings: TeacherWorkload["consecutivePeriodsWarnings"] = [];
  
  for (const day of DAYS) {
    const consecutiveGroups = getConsecutiveTeachingPeriods(timetable, teacher.id, day);
    
    for (const group of consecutiveGroups) {
      periodsByDay[day] += group.count;
      totalPeriods += group.count;
      
      if (group.count >= 4) {
        consecutiveWarnings.push({
          day,
          startPeriod: group.start,
          endPeriod: group.end,
          count: group.count,
        });
      }
    }
  }
  
  return {
    teacherId: teacher.id,
    totalPeriods,
    periodsByDay,
    consecutivePeriodsWarnings: consecutiveWarnings,
  };
}
