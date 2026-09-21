import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import {
  insertTeacherSchema,
  insertSubjectSchema,
  insertSchoolSchema,
  preferredPeriodsSchema,
  requiredDoublesSchema,
  placementRequestSchema,
  timetableSlotSchema,
  type Day,
  type SchoolClass,
  DAYS,
  CLASSES,
  PERIODS_PER_DAY,
  BREAK_AFTER_P4,
  BREAK_AFTER_P7,
  findSlashGroup,
  getQuotaForClass,
  getTeacherSubjectClasses,
  type TimetableSlot,
  type Teacher,
  type Subject,
  type ValidationResult,
  type ValidationError,
} from "@shared/schema";
import { z } from "zod";
import { wouldCrossBreak } from "@shared/timetable-rules";

// Get user ID from authenticated request
function getUserId(req: Request): string {
  return (req.user as { id: string } | undefined)?.id ?? "";
}

function isTeacherAvailable(
  timetable: Map<string, TimetableSlot>,
  teacher: Teacher,
  day: Day,
  period: number
): boolean {
  const unavailablePeriods = teacher.unavailable[day] || [];
  if (unavailablePeriods.includes(period)) return false;
  
  for (const schoolClass of CLASSES) {
    const key = `${day}-${schoolClass}-${period}`;
    const slot = timetable.get(key);
    if (slot && (slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id || slot.slashThirdTeacherId === teacher.id)) {
      return false;
    }
  }
  
  return true;
}

function getConsecutiveSameSubjectCount(
  timetable: Map<string, TimetableSlot>,
  day: Day,
  schoolClass: SchoolClass,
  subject: string,
  newPeriods: number[]
): number {
  const maxPeriods = PERIODS_PER_DAY[day];
  const subjectPeriods = new Set<number>(newPeriods);
  
  for (let period = 1; period <= maxPeriods; period++) {
    const key = `${day}-${schoolClass}-${period}`;
    const slot = timetable.get(key);
    // Check both subject and slashPairSubject for slash subject handling
    if (slot && (slot.subject === subject || slot.slashPairSubject === subject || slot.slashThirdSubject === subject)) {
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
function getTotalSubjectCountForDay(
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
    
    const key = `${day}-${schoolClass}-${period}`;
    const slot = timetable.get(key);
    if (slot && (slot.subject === subject || slot.slashPairSubject === subject || slot.slashThirdSubject === subject)) {
      count++;
    }
  }
  
  return count;
}

// Resolve the consecutive-period limit that should apply to a teacher.
// Falls back to the user's global fatigueLimit when the teacher has no override.
function effectiveFatigueLimit(
  teacher: Teacher | undefined,
  globalLimit: number,
): number {
  if (teacher && typeof teacher.maxConsecutivePeriods === "number") {
    return teacher.maxConsecutivePeriods;
  }
  return globalLimit;
}

function getConsecutiveTeachingCount(
  timetable: Map<string, TimetableSlot>,
  teacherId: string,
  day: Day,
  newPeriods: number[]
): number {
  const maxPeriods = PERIODS_PER_DAY[day];
  const teachingPeriods = new Set<number>(newPeriods);
  
  for (let period = 1; period <= maxPeriods; period++) {
    for (const schoolClass of CLASSES) {
      const key = `${day}-${schoolClass}-${period}`;
      const slot = timetable.get(key);
      if (slot && (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId || slot.slashThirdTeacherId === teacherId)) {
        teachingPeriods.add(period);
        break;
      }
    }
  }
  
  const sorted = Array.from(teachingPeriods).sort((a, b) => a - b);
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

async function validatePlacement(
  userId: string,
  day: Day,
  period: number,
  schoolClass: SchoolClass,
  subject: string,
  teacherId: string,
  slotType: string,
  slashPairSubject?: string,
  slashPairTeacherId?: string,
  slashThirdSubject?: string,
  slashThirdTeacherId?: string,
  // Non-teaching activity (Assembly, Library, ...). When true we skip every
  // teacher- and subject-quota-based check; only the basic cell sanity checks
  // (cell empty + period exists in the day) still run.
  isActivity: boolean = false,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const timetable = await storage.getTimetable(userId);

  // Check that the period actually exists in the day.
  const maxPeriods = PERIODS_PER_DAY[day];
  if (period < 1 || period > maxPeriods) {
    errors.push({
      code: "INVALID_PERIOD",
      message: `Period ${period} does not exist on ${day}`,
      severity: "error",
    });
    return { isValid: false, errors };
  }

  // Activity placements: skip every teacher / subject-quota rule. Just make
  // sure the cell is currently empty (or the same activity being re-placed).
  if (isActivity) {
    const key = `${day}-${schoolClass}-${period}`;
    const existingSlot = timetable.get(key);
    if (existingSlot && existingSlot.status === "occupied") {
      errors.push({
        code: "SLOT_OCCUPIED",
        message: `Period ${period} on ${day} for ${schoolClass} is already scheduled`,
        severity: "error",
      });
    }
    return { isValid: errors.length === 0, errors };
  }

  const teachers = await storage.getTeachers(userId);
  const userSettings = await storage.getUserSettings(userId);
  const allSubjects = await storage.getSubjects(userId);
  const fatigueLimit = userSettings.fatigueLimit;

  if (slotType === "double" && !userSettings.allowDoublePeriods) {
    errors.push({
      code: "DOUBLE_PERIODS_DISABLED",
      message: "Double periods are disabled in Settings",
      severity: "error",
    });
  }
  if (slotType === "double" && period === 8 && !userSettings.allowDoubleInP8P9) {
    errors.push({
      code: "DOUBLE_P8P9_DISABLED",
      message: "Double periods in P8/P9 are disabled in Settings",
      severity: "error",
    });
  }

  const teacher = teachers.find((t) => t.id === teacherId);
  if (!teacher) {
    errors.push({ code: "TEACHER_NOT_FOUND", message: "Teacher not found", severity: "error" });
    return { isValid: false, errors };
  }
  
  // Validate teacher is assigned to teach this subject for this class
  if (!teacher.subjects.includes(subject)) {
    errors.push({
      code: "TEACHER_SUBJECT_MISMATCH",
      message: `${teacher.name} is not assigned to teach ${subject}`,
      severity: "error",
    });
  }
  
  if (!teacher.classes.includes(schoolClass)) {
    errors.push({
      code: "TEACHER_CLASS_MISMATCH",
      message: `${teacher.name} is not assigned to teach ${schoolClass}`,
      severity: "error",
    });
  }
  
  // Check subject-class mapping
  const allowedClasses = getTeacherSubjectClasses(teacher, subject);
  if (!allowedClasses.includes(schoolClass)) {
    errors.push({
      code: "TEACHER_SUBJECT_CLASS_MISMATCH",
      message: `${teacher.name} is not assigned to teach ${subject} to ${schoolClass}`,
      severity: "error",
    });
  }
  
  // Validate teacher availability
  const unavailable = teacher.unavailable[day] || [];
  if (unavailable.includes(period)) {
    errors.push({
      code: "TEACHER_UNAVAILABLE",
      message: `${teacher.name} is unavailable during period ${period} on ${day}`,
      severity: "error",
    });
  }
  
  // Check double period availability
  if (slotType === "double" && unavailable.includes(period + 1)) {
    errors.push({
      code: "TEACHER_UNAVAILABLE",
      message: `${teacher.name} is unavailable during period ${period + 1} on ${day}`,
      severity: "error",
    });
  }
  
  // Check for clashes
  if (!isTeacherAvailable(timetable, teacher, day, period)) {
    errors.push({
      code: "TEACHER_CLASH",
      message: `${teacher.name} is already teaching another class during period ${period}`,
      severity: "error",
    });
  }
  
  // Check double period clash
  if (slotType === "double" && !isTeacherAvailable(timetable, teacher, day, period + 1)) {
    errors.push({
      code: "TEACHER_CLASH",
      message: `${teacher.name} is already teaching another class during period ${period + 1}`,
      severity: "error",
    });
  }
  
  // Check if slot is already occupied
  const key = `${day}-${schoolClass}-${period}`;
  const existingSlot = timetable.get(key);
  if (existingSlot && existingSlot.status === "occupied") {
    errors.push({
      code: "SLOT_OCCUPIED",
      message: `Period ${period} on ${day} for ${schoolClass} is already scheduled`,
      severity: "error",
    });
  }
  
  // Double period checks
  if (slotType === "double") {
    const maxPeriods = PERIODS_PER_DAY[day];
    if (period + 1 > maxPeriods) {
      errors.push({
        code: "INVALID_DOUBLE",
        message: "Double period would exceed the day's schedule",
        severity: "error",
      });
    }
    
    if (wouldCrossBreak(day, period)) {
      errors.push({
        code: "BREAK_VIOLATION",
        message: "Double period cannot cross break time",
        severity: "error",
      });
    }
    
    // Check if next slot is occupied
    const nextKey = `${day}-${schoolClass}-${period + 1}`;
    const nextSlot = timetable.get(nextKey);
    if (nextSlot && nextSlot.status === "occupied") {
      errors.push({
        code: "SLOT_OCCUPIED",
        message: `Period ${period + 1} on ${day} for ${schoolClass} is already scheduled`,
        severity: "error",
      });
    }
    
  }
  
  // Slash subject validation (two- or three-way groups).
  if (slotType === "slash") {
    const group = findSlashGroup(allSubjects, subject, schoolClass);
    const expectedPartners = group.filter((s) => s.name !== subject).map((s) => s.name);
    const requestedPartners = [slashPairSubject, slashThirdSubject]
      .filter((name): name is string => !!name);

    if (group.length < 2) {
      errors.push({
        code: "INVALID_SLASH",
        message: `${subject} is not configured as a slash group`,
        severity: "error",
      });
    } else if ([...expectedPartners].sort().join("|") !== [...requestedPartners].sort().join("|")) {
      errors.push({
        code: "SLASH_GROUP_MISMATCH",
        message: `${subject} must be scheduled with ${expectedPartners.join(" / ")}`,
        severity: "error",
      });
    }

    const extras = [
      { subject: slashPairSubject, teacherId: slashPairTeacherId },
      { subject: slashThirdSubject, teacherId: slashThirdTeacherId },
    ].filter((item) => !!item.subject);

    for (const extra of extras) {
      if (!extra.teacherId) {
        errors.push({
          code: "MISSING_SLASH_TEACHER",
          message: `Slash subject ${extra.subject} requires a teacher`,
          severity: "error",
        });
        continue;
      }
      if (extra.teacherId === teacherId || extras.some((other) => other !== extra && other.teacherId === extra.teacherId)) {
        errors.push({
          code: "SLASH_TEACHER_DUPLICATE",
          message: "Each slash subject must have a different teacher",
          severity: "error",
        });
        continue;
      }
      const slashTeacher = teachers.find((t) => t.id === extra.teacherId);
      if (!slashTeacher) {
        errors.push({
          code: "SLASH_TEACHER_NOT_FOUND",
          message: `Teacher for ${extra.subject} was not found`,
          severity: "error",
        });
        continue;
      }
      if (!slashTeacher.subjects.includes(extra.subject!)) {
        errors.push({
          code: "SLASH_TEACHER_SUBJECT_MISMATCH",
          message: `${slashTeacher.name} is not assigned to teach ${extra.subject}`,
          severity: "error",
        });
      }
      if (!slashTeacher.classes.includes(schoolClass) || !getTeacherSubjectClasses(slashTeacher, extra.subject!).includes(schoolClass)) {
        errors.push({
          code: "SLASH_TEACHER_CLASS_MISMATCH",
          message: `${slashTeacher.name} is not assigned to teach ${extra.subject} to ${schoolClass}`,
          severity: "error",
        });
      }
      if ((slashTeacher.unavailable[day] || []).includes(period)) {
        errors.push({
          code: "SLASH_TEACHER_UNAVAILABLE",
          message: `${slashTeacher.name} is unavailable during period ${period} on ${day}`,
          severity: "error",
        });
      }
      if (!isTeacherAvailable(timetable, slashTeacher, day, period)) {
        errors.push({
          code: "SLASH_TEACHER_CLASH",
          message: `${slashTeacher.name} is already teaching another class during period ${period}`,
          severity: "error",
        });
      }
      const slashConsecutive = getConsecutiveTeachingCount(timetable, extra.teacherId, day, [period]);
      const slashLimit = effectiveFatigueLimit(slashTeacher, fatigueLimit);
      if (slashConsecutive > slashLimit) {
        errors.push({
          code: "SLASH_TEACHER_FATIGUE",
          message: `${slashTeacher.name} would exceed ${slashLimit} consecutive teaching periods`,
          severity: "error",
        });
      }
    }
  }
  
  // Fatigue limit check (per-teacher override wins over global)
  const periodsToAdd = slotType === "double" ? [period, period + 1] : [period];
  const consecutive = getConsecutiveTeachingCount(timetable, teacherId, day, periodsToAdd);
  const teacherLimit = effectiveFatigueLimit(teacher, fatigueLimit);
  if (consecutive > teacherLimit) {
    errors.push({
      code: "FATIGUE_LIMIT",
      message: `${teacher.name} would exceed ${teacherLimit} consecutive teaching periods`,
      severity: "error",
    });
  }
  
  // Subject can only appear once per day per class
  const dailySubjectCount = getTotalSubjectCountForDay(timetable, day, schoolClass, subject, []);
  if (dailySubjectCount >= 1) {
    errors.push({
      code: "SUBJECT_ALREADY_SCHEDULED",
      message: `${subject} is already scheduled for ${schoolClass} on ${day}`,
      severity: "error",
    });
  }
  
  // For slash subjects, also check every partner subject.
  for (const partnerSubject of [slashPairSubject, slashThirdSubject].filter((s): s is string => !!s)) {
    const dailyPairCount = getTotalSubjectCountForDay(timetable, day, schoolClass, partnerSubject, []);
    if (dailyPairCount >= 1) {
      errors.push({
        code: "SUBJECT_ALREADY_SCHEDULED",
        message: `${partnerSubject} is already scheduled for ${schoolClass} on ${day}`,
        severity: "error",
      });
    }
  }
  
  return {
    isValid: errors.filter((e) => e.severity === "error").length === 0,
    errors,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication
  await setupAuth(app);
  registerAuthRoutes(app);

  // ===== School workspaces =====
  app.get("/api/schools", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      await storage.initializeUserData(userId);
      res.json(await storage.getSchools(userId));
    } catch (error) {
      console.error("List schools error:", error);
      res.status(500).json({ error: "Failed to list schools" });
    }
  });

  app.post("/api/schools", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { name } = insertSchoolSchema.parse(req.body);
      const school = await storage.createSchool(userId, name);
      res.status(201).json(school);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid school data", details: error.errors });
      } else {
        console.error("Create school error:", error);
        res.status(500).json({ error: "Failed to create school" });
      }
    }
  });

  app.patch("/api/schools/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { name } = insertSchoolSchema.parse(req.body);
      const school = await storage.renameSchool(userId, req.params.id, name);
      if (!school) {
        res.status(404).json({ error: "School not found" });
        return;
      }
      res.json(school);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid school data", details: error.errors });
      } else {
        console.error("Rename school error:", error);
        res.status(500).json({ error: "Failed to rename school" });
      }
    }
  });

  app.post("/api/schools/:id/activate", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const school = await storage.activateSchool(userId, req.params.id);
      if (!school) {
        res.status(404).json({ error: "School not found" });
        return;
      }
      res.json(school);
    } catch (error) {
      console.error("Activate school error:", error);
      res.status(500).json({ error: "Failed to switch school" });
    }
  });

  // Get all teachers
  app.get("/api/teachers", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    await storage.initializeUserData(userId);
    const teachers = await storage.getTeachers(userId);
    res.json(teachers);
  });

  // Create teacher
  app.post("/api/teachers", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const data = insertTeacherSchema.parse(req.body);
      const teacher = await storage.createTeacher(userId, data);
      res.status(201).json(teacher);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid teacher data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create teacher" });
      }
    }
  });

  // Update teacher
  app.patch("/api/teachers/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { id } = req.params;
      const updates = req.body;
      const teacher = await storage.updateTeacher(userId, id, updates);
      if (teacher) {
        res.json(teacher);
      } else {
        res.status(404).json({ error: "Teacher not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to update teacher" });
    }
  });

  // Delete teacher
  app.delete("/api/teachers/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const { id } = req.params;
    const deleted = await storage.deleteTeacher(userId, id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Teacher not found" });
    }
  });

  // Get timetable
  app.get("/api/timetable", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    await storage.initializeUserData(userId);
    const timetable = await storage.getTimetable(userId);
    const slots = Array.from(timetable.values());
    res.json(slots);
  });

  // Validate placement
  app.post("/api/timetable/validate", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const data = placementRequestSchema.parse(req.body);
      const isActivity = data.isActivity || data.slotType === "activity";
      const result = await validatePlacement(
        userId,
        data.day,
        data.period,
        data.schoolClass,
        data.subject,
        data.teacherId ?? "",
        data.slotType,
        data.slashPairSubject,
        data.slashPairTeacherId,
        data.slashThirdSubject,
        data.slashThirdTeacherId,
        isActivity,
      );
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid placement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Validation failed" });
      }
    }
  });

  // Place subject (or activity / fixed period).
  // Supports `applyToAllClasses` for activities only — schedules the same
  // label across every class at the same day + period in one batch. The whole
  // batch fails if any single class fails validation.
  app.post("/api/timetable/place", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const data = placementRequestSchema.parse(req.body);
      const isActivity = data.isActivity || data.slotType === "activity";

      if (data.applyToAllClasses && !isActivity) {
        res.status(400).json({
          error: "Apply to all classes is only supported for non-teaching activities",
        });
        return;
      }
      if (data.applyToAllClasses && data.slotType === "double") {
        res.status(400).json({
          error: "Apply to all classes does not support double periods",
        });
        return;
      }

      // Default: activities are always locked, real-subject placements honour
      // the explicit isLocked flag (defaulting to false).
      const isLocked = data.isLocked ?? isActivity;

      const targetClasses: SchoolClass[] = data.applyToAllClasses
        ? [...CLASSES]
        : [data.schoolClass];

      // Validate every target class up-front so partial bulk writes never
      // happen.
      const perClassResults: Array<{ schoolClass: SchoolClass; validation: ValidationResult }> = [];
      for (const cls of targetClasses) {
        const validation = await validatePlacement(
          userId,
          data.day,
          data.period,
          cls,
          data.subject,
          data.teacherId ?? "",
          data.slotType,
          data.slashPairSubject,
          data.slashPairTeacherId,
          data.slashThirdSubject,
          data.slashThirdTeacherId,
          isActivity,
        );
        perClassResults.push({ schoolClass: cls, validation });
      }

      const failures = perClassResults.filter((r) => !r.validation.isValid);
      if (failures.length > 0) {
        res.status(400).json({
          error: data.applyToAllClasses
            ? `Validation failed for ${failures.length} class(es); nothing was placed`
            : "Validation failed",
          validation: perClassResults[0].validation,
          perClass: perClassResults,
        });
        return;
      }

      const placedSlots: TimetableSlot[] = [];
      const allSlotsToWrite: TimetableSlot[] = [];
      for (const cls of targetClasses) {
        const slot: TimetableSlot = {
          day: data.day,
          period: data.period,
          schoolClass: cls,
          status: "occupied",
          subject: data.subject,
          teacherId: isActivity ? null : (data.teacherId ?? null),
          slotType: data.slotType,
          slashPairSubject: data.slashPairSubject || null,
          slashPairTeacherId: data.slashPairTeacherId || null,
          slashThirdSubject: data.slashThirdSubject || null,
          slashThirdTeacherId: data.slashThirdTeacherId || null,
          isLocked,
        };
        placedSlots.push(slot);
        allSlotsToWrite.push(slot);

        if (data.slotType === "double") {
          allSlotsToWrite.push({ ...slot, period: data.period + 1 });
        }
      }

      // All-or-nothing write inside a single transaction. If a concurrent
      // request occupies any of the target rows after our pre-validation,
      // the in-tx empty-check throws and the whole batch is rolled back.
      try {
        await storage.setSlotsAtomic(userId, allSlotsToWrite, true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("SLOT_OCCUPIED:")) {
          const [, day, cls, period] = msg.split(":");
          res.status(409).json({
            error: `Slot ${day} ${cls} P${period} was just taken; nothing was placed`,
          });
          return;
        }
        throw e;
      }

      for (const slot of placedSlots) {
        await storage.addAction(userId, {
          type: "place",
          timestamp: Date.now(),
          slot,
          previousSlot: null,
        });
      }

      res.json({
        success: true,
        slot: placedSlots[0],
        slots: placedSlots,
        appliedToAllClasses: !!data.applyToAllClasses,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid placement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to place subject" });
      }
    }
  });

  // Remove subject. Locked slots (fixed periods + activities) require an
  // explicit `?force=true` query param so accidental clicks don't wipe a
  // user-pinned cell.
  app.delete("/api/timetable/:day/:class/:period", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const { day, class: schoolClass, period } = req.params;

    if (!DAYS.includes(day as Day) || !CLASSES.includes(schoolClass as SchoolClass)) {
      res.status(400).json({ error: "Invalid day or class" });
      return;
    }

    const periodNum = parseInt(period);
    const force = req.query.force === "true";

    const existing = await storage.getSlot(
      userId,
      day as Day,
      schoolClass as SchoolClass,
      periodNum,
    );

    if (existing && existing.status === "occupied" && existing.isLocked && !force) {
      res.status(409).json({
        error: "Locked slot",
        message: "This is a fixed period. Pass ?force=true to remove it.",
      });
      return;
    }

    const cleared = await storage.clearSlot(
      userId,
      day as Day,
      schoolClass as SchoolClass,
      periodNum,
    );

    if (cleared) {
      res.json({ success: true, slot: cleared });
    } else {
      res.status(404).json({ error: "Slot not found" });
    }
  });

  // Get actions history
  app.get("/api/actions", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const actions = await storage.getActions(userId);
    res.json(actions);
  });

  // ===== Subject Quotas =====
  
  // Get all subject quotas
  app.get("/api/quotas", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    await storage.initializeUserData(userId);
    const quotas = await storage.getSubjectQuotas(userId);
    res.json(quotas);
  });

  // Atomically update all members of a 2- or 3-subject slash group.
  app.patch("/api/quotas/slash-group", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        subjects: z.array(z.string().min(1)).min(2).max(3),
        field: z.enum(["jssQuota", "jss1Quota", "jss2Quota", "jss3Quota", "ss1Quota", "ss2Quota", "ss3Quota", "ss2ss3Quota"]),
        value: z.number().int().min(0).max(10),
      });
      const { subjects: names, field, value } = schema.parse(req.body);
      if (new Set(names).size !== names.length) {
        res.status(400).json({ error: "Slash group subjects must differ" });
        return;
      }
      const result = await storage.updateSlashGroupQuota(userId, names, field, value);
      if (!result) {
        res.status(404).json({ error: "Slash group subject not found" });
        return;
      }
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid slash-group quota data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update slash-group quota" });
      }
    }
  });

  // Atomically update both partners of a slash pair to the same quota value.
  // Used by the slash-pair input on the Settings page so the two halves can
  // never end up disagreeing if a network hiccup interrupts a sequential pair
  // of writes.
  app.patch("/api/quotas/slash-pair", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const slashPairSchema = z.object({
        subjectA: z.string().min(1),
        subjectB: z.string().min(1),
        field: z.enum(["jssQuota", "jss1Quota", "jss2Quota", "jss3Quota", "ss1Quota", "ss2Quota", "ss3Quota", "ss2ss3Quota"]),
        value: z.number().int().min(0).max(10),
      });
      const { subjectA, subjectB, field, value } = slashPairSchema.parse(req.body);
      if (subjectA === subjectB) {
        res.status(400).json({ error: "Slash pair partners must differ" });
        return;
      }
      const result = await storage.updateSlashPairQuota(userId, subjectA, subjectB, field, value);
      if (!result) {
        res.status(404).json({ error: "Slash pair partner not found" });
        return;
      }
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid slash-pair quota data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update slash-pair quota" });
      }
    }
  });

  // Update subject quota
  app.patch("/api/quotas/:subject", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { subject } = req.params;
      
      const partialQuotaSchema = z.object({
        jssQuota: z.number().min(0).max(10).optional(),
        jss1Quota: z.number().min(0).max(10).optional(),
        jss2Quota: z.number().min(0).max(10).optional(),
        jss3Quota: z.number().min(0).max(10).optional(),
        ss1Quota: z.number().min(0).max(10).optional(),
        ss2Quota: z.number().min(0).max(10).optional(),
        ss3Quota: z.number().min(0).max(10).optional(),
        ss2ss3Quota: z.number().min(0).max(10).optional(),
        isSlashSubject: z.boolean().optional(),
      });
      
      const updates = partialQuotaSchema.parse(req.body);
      const quota = await storage.updateSubjectQuota(userId, decodeURIComponent(subject), updates);
      if (quota) {
        res.json(quota);
      } else {
        res.status(404).json({ error: "Subject quota not found" });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid quota data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update quota" });
      }
    }
  });

  // ===== User Settings =====

  // Get user settings
  app.get("/api/settings", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const settings = await storage.getUserSettings(userId);
    res.json(settings);
  });

  // Update user settings
  app.patch("/api/settings", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const settingsSchema = z.object({
        fatigueLimit: z.number().min(1).max(10).optional(),
        maxFreePeriodsPerWeek: z.number().min(0).max(10).optional(),
        maxFreePeriodsPerDay: z.number().min(0).max(5).optional(),
        freePeriodsPerClass: z
          .record(z.enum(CLASSES), z.number().min(0).max(40))
          .optional(),
        allowDoublePeriods: z.boolean().optional(),
        allowDoubleInP8P9: z.boolean().optional(),
      });
      const updates = settingsSchema.parse(req.body);
      const settings = await storage.updateUserSettings(userId, updates);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("[PATCH /api/settings] validation error:", JSON.stringify(error.errors), "body:", JSON.stringify(req.body));
        res.status(400).json({ error: "Invalid settings data", details: error.errors });
      } else {
        console.error("[PATCH /api/settings] failed:", error, "body:", JSON.stringify(req.body));
        res.status(500).json({ error: "Failed to update settings" });
      }
    }
  });

  // ===== Custom Subjects =====
  
  // Get all subjects
  app.get("/api/subjects", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    await storage.initializeUserData(userId);
    const subjectsList = await storage.getSubjects(userId);
    res.json(subjectsList);
  });

  // Create subject
  app.post("/api/subjects", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const data = insertSubjectSchema.parse(req.body);
      
      // Check if subject name already exists
      const existing = await storage.getSubjects(userId);
      if (existing.some(s => s.name.toLowerCase() === data.name.toLowerCase())) {
        res.status(400).json({ error: "A subject with this name already exists" });
        return;
      }
      
      const subject = await storage.createSubject(userId, data);
      res.status(201).json(subject);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid subject data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create subject" });
      }
    }
  });

  // Update subject
  app.patch("/api/subjects/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid subject ID" });
        return;
      }
      
      const partialSubjectSchema = z.object({
        name: z.string().min(1).optional(),
        jssQuota: z.number().min(0).max(10).optional(),
        jss1Quota: z.number().min(0).max(10).optional(),
        jss2Quota: z.number().min(0).max(10).optional(),
        jss3Quota: z.number().min(0).max(10).optional(),
        ss1Quota: z.number().min(0).max(10).optional(),
        ss2Quota: z.number().min(0).max(10).optional(),
        ss3Quota: z.number().min(0).max(10).optional(),
        ss2ss3Quota: z.number().min(0).max(10).optional(),
        isSlashSubject: z.boolean().optional(),
        slashPairName: z.string().nullable().optional(),
        slashThirdName: z.string().nullable().optional(),
        ss2SlashPairName: z.string().nullable().optional(),
        ss2SlashThirdName: z.string().nullable().optional(),
        ss3SlashPairName: z.string().nullable().optional(),
        ss3SlashThirdName: z.string().nullable().optional(),
        singleOnly: z.boolean().optional(),
        preferredPeriods: preferredPeriodsSchema.optional(),
        requiredDoubles: requiredDoublesSchema.optional(),
      });
      
      const updates = partialSubjectSchema.parse(req.body);
      const subject = await storage.updateSubject(userId, id, updates);
      if (subject) {
        res.json(subject);
      } else {
        res.status(404).json({ error: "Subject not found" });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid subject data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update subject" });
      }
    }
  });

  // Delete subject
  app.delete("/api/subjects/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid subject ID" });
      return;
    }
    
    const deleted = await storage.deleteSubject(userId, id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Subject not found" });
    }
  });

  // ===== Auto-Generation =====
  
  app.post("/api/timetable/autogenerate", isAuthenticated, async (req, res) => {
    const userId = (() => { try { return getUserId(req); } catch { return "<unknown>"; } })();
    const { lockExisting = false, clearFirst = true } = req.body ?? {};
    try {
      const result = await storage.autoGenerateTimetable(userId, lockExisting, clearFirst);
      res.json(result);
    } catch (error) {
      const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(
        `[autogenerate] failed user=${userId} lockExisting=${lockExisting} clearFirst=${clearFirst}:`,
        stack,
      );
      res.status(500).json({
        success: false,
        slotsPlaced: 0,
        warnings: [],
        errors: ["Failed to auto-generate timetable: " + (error instanceof Error ? error.message : "Unknown error")]
      });
    }
  });

  // ===== Timetable Sharing =====

  // Create a shareable link
  app.post("/api/timetable/share", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { title } = req.body;
      
      const timetable = await storage.getTimetable(userId);
      const teachers = await storage.getTeachers(userId);
      
      const timetableData = Array.from(timetable.values()).filter(slot => slot.status === "occupied");
      
      const shared = await storage.createSharedTimetable(userId, timetableData, teachers, title);
      res.json({ shareId: shared.id, shareUrl: `/shared/${shared.id}` });
    } catch (error) {
      console.error("Share error:", error);
      res.status(500).json({ error: "Failed to create shareable link" });
    }
  });

  // Get a shared timetable (public - no auth required)
  app.get("/api/shared/:shareId", async (req, res) => {
    try {
      const { shareId } = req.params;
      const shared = await storage.getSharedTimetable(shareId);
      
      if (!shared) {
        res.status(404).json({ error: "Shared timetable not found" });
        return;
      }
      
      res.json(shared);
    } catch (error) {
      console.error("Get shared error:", error);
      res.status(500).json({ error: "Failed to get shared timetable" });
    }
  });

  // Get user's shared timetables
  app.get("/api/timetable/shares", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const shares = await storage.getUserSharedTimetables(userId);
      res.json(shares);
    } catch (error) {
      console.error("Get shares error:", error);
      res.status(500).json({ error: "Failed to get shared timetables" });
    }
  });

  // Delete a shared timetable
  app.delete("/api/timetable/share/:shareId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { shareId } = req.params;
      
      await storage.deleteSharedTimetable(userId, shareId);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete share error:", error);
      res.status(500).json({ error: "Failed to delete shared timetable" });
    }
  });

  // ===== Saved Timetables =====

  app.get("/api/saved-timetables", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const items = await storage.listSavedTimetables(userId);
      res.json(items);
    } catch (error) {
      console.error("List saved error:", error);
      res.status(500).json({ error: "Failed to list saved timetables" });
    }
  });

  app.post("/api/saved-timetables", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      // The live grid is maintained client-side, so the snapshot's source of
      // truth is the slots posted by the client (validated server-side).
      const bodySchema = z.object({
        name: z.string().trim().min(1, "Name is required").max(100),
        slots: z.array(timetableSlotSchema),
      });
      const { name, slots } = bodySchema.parse(req.body);
      if (!slots.some((s) => s.status === "occupied")) {
        res.status(400).json({ error: "Cannot save an empty timetable" });
        return;
      }
      // Persist the entire grid snapshot (every slot, including empty/break)
      // so the saved state is a faithful, fully-restorable copy.
      const saved = await storage.createSavedTimetable(userId, name, slots);
      res.status(201).json(saved);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid request", details: error.errors });
      } else {
        console.error("Create saved error:", error);
        res.status(500).json({ error: "Failed to save timetable" });
      }
    }
  });

  app.get("/api/saved-timetables/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const saved = await storage.getSavedTimetable(userId, req.params.id);
      if (!saved) {
        res.status(404).json({ error: "Saved timetable not found" });
        return;
      }
      res.json(saved);
    } catch (error) {
      console.error("Get saved error:", error);
      res.status(500).json({ error: "Failed to get saved timetable" });
    }
  });

  app.patch("/api/saved-timetables/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const nameSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(100) });
      const { name } = nameSchema.parse(req.body);
      const saved = await storage.renameSavedTimetable(userId, req.params.id, name);
      if (!saved) {
        res.status(404).json({ error: "Saved timetable not found" });
        return;
      }
      res.json(saved);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid name", details: error.errors });
      } else {
        console.error("Rename saved error:", error);
        res.status(500).json({ error: "Failed to rename saved timetable" });
      }
    }
  });

  app.delete("/api/saved-timetables/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const deleted = await storage.deleteSavedTimetable(userId, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "Saved timetable not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete saved error:", error);
      res.status(500).json({ error: "Failed to delete saved timetable" });
    }
  });

  app.post("/api/saved-timetables/:id/load", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const ok = await storage.loadSavedTimetable(userId, req.params.id);
      if (!ok) {
        res.status(404).json({ error: "Saved timetable not found" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Load saved error:", error);
      res.status(500).json({ error: "Failed to load saved timetable" });
    }
  });

  return httpServer;
}
