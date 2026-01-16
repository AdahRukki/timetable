import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertTeacherSchema,
  placementRequestSchema,
  subjectQuotaSchema,
  type Day,
  type SchoolClass,
  type SubjectQuota,
  type AutoGenerateResult,
  DAYS,
  CLASSES,
  PERIODS_PER_DAY,
  BREAK_AFTER_P4,
  BREAK_AFTER_P7,
  SLASH_SUBJECTS,
  usesSlashSubjects,
  getQuotaForClass,
  getTeacherSubjectClasses,
  type TimetableSlot,
  type Teacher,
  type ValidationResult,
  type ValidationError,
} from "@shared/schema";
import { z } from "zod";

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
    if (slot && (slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id)) {
      return false;
    }
  }
  
  return true;
}

function wouldCrossBreak(day: Day, startPeriod: number): boolean {
  const maxPeriods = PERIODS_PER_DAY[day];
  if (startPeriod >= maxPeriods) return true;
  if (startPeriod === BREAK_AFTER_P4) return true;
  if (day !== "Friday" && day !== "Tuesday" && startPeriod === BREAK_AFTER_P7) return true;
  return false;
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
      if (slot && (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId)) {
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
  day: Day,
  period: number,
  schoolClass: SchoolClass,
  subject: string,
  teacherId: string,
  slotType: string,
  slashPairSubject?: string,
  slashPairTeacherId?: string
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const teachers = await storage.getTeachers();
  const timetable = await storage.getTimetable();
  
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
  
  // Check subject-class mapping if present
  const allowedClassesForSubject = getTeacherSubjectClasses(teacher, subject);
  if (!allowedClassesForSubject.includes(schoolClass)) {
    errors.push({
      code: "TEACHER_SUBJECT_CLASS_MISMATCH",
      message: `${teacher.name} is not assigned to teach ${subject} to ${schoolClass}`,
      severity: "error",
    });
  }
  
  const key = `${day}-${schoolClass}-${period}`;
  const slot = timetable.get(key);
  if (slot && slot.status === "occupied") {
    errors.push({ code: "SLOT_OCCUPIED", message: `Period ${period} is already occupied`, severity: "error" });
  }
  
  const unavailablePeriods = teacher.unavailable[day] || [];
  if (unavailablePeriods.includes(period)) {
    errors.push({
      code: "TEACHER_UNAVAILABLE",
      message: `${teacher.name} is unavailable during period ${period} on ${day}`,
      severity: "error",
    });
  }
  
  if (!isTeacherAvailable(timetable, teacher, day, period)) {
    errors.push({
      code: "TEACHER_CLASH",
      message: `${teacher.name} is already teaching another class during period ${period}`,
      severity: "error",
    });
  }
  
  // Double period validation
  if (slotType === "double") {
    const maxPeriods = PERIODS_PER_DAY[day];
    if (period >= maxPeriods) {
      errors.push({
        code: "INVALID_DOUBLE",
        message: "Cannot start a double period at the last period",
        severity: "error",
      });
    }
    if (period >= 8) {
      errors.push({ code: "NO_DOUBLE_P8_P9", message: "Double periods not allowed in P8 or P9", severity: "error" });
    }
    if (wouldCrossBreak(day, period)) {
      errors.push({ code: "DOUBLE_CROSSES_BREAK", message: "Double period cannot cross a break", severity: "error" });
    }
    
    const nextKey = `${day}-${schoolClass}-${period + 1}`;
    const nextSlot = timetable.get(nextKey);
    if (nextSlot && nextSlot.status === "occupied") {
      errors.push({
        code: "NEXT_SLOT_OCCUPIED",
        message: `Period ${period + 1} is already occupied`,
        severity: "error",
      });
    }
    
    if (!isTeacherAvailable(timetable, teacher, day, period + 1)) {
      errors.push({
        code: "TEACHER_CLASH_DOUBLE",
        message: `${teacher.name} not available for period ${period + 1}`,
        severity: "error",
      });
    }
  }
  
  // Slash subject validation
  if (slotType === "slash") {
    // Slash subjects only allowed for SS2 and SS3
    if (!usesSlashSubjects(schoolClass)) {
      errors.push({
        code: "SLASH_NOT_ALLOWED",
        message: "Slash subjects are only allowed for SS2 and SS3 classes",
        severity: "error",
      });
    }
    
    // Validate subject is part of a valid slash pair
    const slashPair = SLASH_SUBJECTS.find((s) => s.pair.includes(subject));
    if (!slashPair) {
      errors.push({
        code: "INVALID_SLASH_SUBJECT",
        message: `${subject} is not a valid slash subject`,
        severity: "error",
      });
    } else {
      // Validate slash pair subject is correct
      const expectedPairSubject = slashPair.pair.find((s) => s !== subject);
      if (slashPairSubject !== expectedPairSubject) {
        errors.push({
          code: "INVALID_SLASH_PAIR",
          message: `${subject} must be paired with ${expectedPairSubject}`,
          severity: "error",
        });
      }
    }
    
    // Validate slash pair teacher is provided
    if (!slashPairTeacherId) {
      errors.push({
        code: "MISSING_SLASH_TEACHER",
        message: "Slash subjects require a teacher for the paired subject",
        severity: "error",
      });
    } else {
      const slashPairTeacher = teachers.find((t) => t.id === slashPairTeacherId);
      if (!slashPairTeacher) {
        errors.push({
          code: "SLASH_TEACHER_NOT_FOUND",
          message: "Paired subject teacher not found",
          severity: "error",
        });
      } else {
        // Validate slash pair teacher is assigned to teach the paired subject
        if (slashPairSubject && !slashPairTeacher.subjects.includes(slashPairSubject)) {
          errors.push({
            code: "SLASH_TEACHER_SUBJECT_MISMATCH",
            message: `${slashPairTeacher.name} is not assigned to teach ${slashPairSubject}`,
            severity: "error",
          });
        }
        
        if (!slashPairTeacher.classes.includes(schoolClass)) {
          errors.push({
            code: "SLASH_TEACHER_CLASS_MISMATCH",
            message: `${slashPairTeacher.name} is not assigned to teach ${schoolClass}`,
            severity: "error",
          });
        }
        
        // Check slash pair teacher subject-class mapping
        if (slashPairSubject) {
          const allowedClassesForSlashSubject = getTeacherSubjectClasses(slashPairTeacher, slashPairSubject);
          if (!allowedClassesForSlashSubject.includes(schoolClass)) {
            errors.push({
              code: "SLASH_TEACHER_SUBJECT_CLASS_MISMATCH",
              message: `${slashPairTeacher.name} is not assigned to teach ${slashPairSubject} to ${schoolClass}`,
              severity: "error",
            });
          }
        }
        
        // Validate slash pair teacher availability
        const slashUnavailable = slashPairTeacher.unavailable[day] || [];
        if (slashUnavailable.includes(period)) {
          errors.push({
            code: "SLASH_TEACHER_UNAVAILABLE",
            message: `${slashPairTeacher.name} is unavailable during period ${period} on ${day}`,
            severity: "error",
          });
        }
        
        // Validate slash pair teacher is not clashing
        if (!isTeacherAvailable(timetable, slashPairTeacher, day, period)) {
          errors.push({
            code: "SLASH_TEACHER_CLASH",
            message: `${slashPairTeacher.name} is already teaching another class during period ${period}`,
            severity: "error",
          });
        }
        
        // Check fatigue for slash pair teacher
        const slashPeriodsToAdd = [period];
        const slashConsecutive = getConsecutiveTeachingCount(timetable, slashPairTeacherId, day, slashPeriodsToAdd);
        if (slashConsecutive > 5) {
          errors.push({
            code: "SLASH_TEACHER_FATIGUE",
            message: `${slashPairTeacher.name} would exceed 5 consecutive teaching periods`,
            severity: "error",
          });
        }
      }
    }
  }
  
  // Fatigue limit check
  const periodsToAdd = slotType === "double" ? [period, period + 1] : [period];
  const consecutive = getConsecutiveTeachingCount(timetable, teacherId, day, periodsToAdd);
  if (consecutive > 5) {
    errors.push({
      code: "FATIGUE_LIMIT",
      message: `${teacher.name} would exceed 5 consecutive teaching periods`,
      severity: "error",
    });
  }
  
  // English-Security rule
  if (subject === "Security") {
    const prevKey = `${day}-${schoolClass}-${period - 1}`;
    const prevSlot = timetable.get(prevKey);
    if (prevSlot && prevSlot.subject === "English") {
      errors.push({
        code: "ENGLISH_SECURITY",
        message: "Security cannot immediately follow English",
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
  // Get all teachers
  app.get("/api/teachers", async (req, res) => {
    const teachers = await storage.getTeachers();
    res.json(teachers);
  });

  // Create teacher
  app.post("/api/teachers", async (req, res) => {
    try {
      const data = insertTeacherSchema.parse(req.body);
      const teacher = await storage.createTeacher(data);
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
  app.patch("/api/teachers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const teacher = await storage.updateTeacher(id, updates);
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
  app.delete("/api/teachers/:id", async (req, res) => {
    const { id } = req.params;
    const deleted = await storage.deleteTeacher(id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Teacher not found" });
    }
  });

  // Get timetable
  app.get("/api/timetable", async (req, res) => {
    const timetable = await storage.getTimetable();
    const slots = Array.from(timetable.values());
    res.json(slots);
  });

  // Validate placement
  app.post("/api/timetable/validate", async (req, res) => {
    try {
      const data = placementRequestSchema.parse(req.body);
      const result = await validatePlacement(
        data.day,
        data.period,
        data.schoolClass,
        data.subject,
        data.teacherId,
        data.slotType,
        data.slashPairSubject,
        data.slashPairTeacherId
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

  // Place subject
  app.post("/api/timetable/place", async (req, res) => {
    try {
      const data = placementRequestSchema.parse(req.body);
      
      const validation = await validatePlacement(
        data.day,
        data.period,
        data.schoolClass,
        data.subject,
        data.teacherId,
        data.slotType,
        data.slashPairSubject,
        data.slashPairTeacherId
      );
      
      if (!validation.isValid) {
        res.status(400).json({ error: "Validation failed", validation });
        return;
      }
      
      const slot: TimetableSlot = {
        day: data.day,
        period: data.period,
        schoolClass: data.schoolClass,
        status: "occupied",
        subject: data.subject,
        teacherId: data.teacherId,
        slotType: data.slotType,
        slashPairSubject: data.slashPairSubject || null,
        slashPairTeacherId: data.slashPairTeacherId || null,
      };
      
      await storage.setSlot(slot);
      
      if (data.slotType === "double") {
        const nextSlot: TimetableSlot = {
          ...slot,
          period: data.period + 1,
        };
        await storage.setSlot(nextSlot);
      }
      
      await storage.addAction({
        type: "place",
        timestamp: Date.now(),
        slot,
        previousSlot: null,
      });
      
      res.json({ success: true, slot });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid placement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to place subject" });
      }
    }
  });

  // Remove subject
  app.delete("/api/timetable/:day/:class/:period", async (req, res) => {
    const { day, class: schoolClass, period } = req.params;
    
    if (!DAYS.includes(day as Day) || !CLASSES.includes(schoolClass as SchoolClass)) {
      res.status(400).json({ error: "Invalid day or class" });
      return;
    }
    
    const cleared = await storage.clearSlot(
      day as Day,
      schoolClass as SchoolClass,
      parseInt(period)
    );
    
    if (cleared) {
      res.json({ success: true, slot: cleared });
    } else {
      res.status(404).json({ error: "Slot not found" });
    }
  });

  // Get actions history
  app.get("/api/actions", async (req, res) => {
    const actions = await storage.getActions();
    res.json(actions);
  });

  // ===== Subject Quotas =====
  
  // Get all subject quotas
  app.get("/api/quotas", async (req, res) => {
    const quotas = await storage.getSubjectQuotas();
    res.json(quotas);
  });

  // Update subject quota
  app.patch("/api/quotas/:subject", async (req, res) => {
    try {
      const { subject } = req.params;
      
      const partialQuotaSchema = z.object({
        jssQuota: z.number().min(0).max(10).optional(),
        ss1Quota: z.number().min(0).max(10).optional(),
        ss2ss3Quota: z.number().min(0).max(10).optional(),
        isSlashSubject: z.boolean().optional(),
      });
      
      const updates = partialQuotaSchema.parse(req.body);
      const quota = await storage.updateSubjectQuota(decodeURIComponent(subject), updates);
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

  // Reset quotas to defaults
  app.post("/api/quotas/reset", async (req, res) => {
    const quotas = await storage.resetSubjectQuotas();
    res.json(quotas);
  });

  // ===== Auto-Generation =====
  
  app.post("/api/timetable/autogenerate", async (req, res) => {
    try {
      const { lockExisting = false, clearFirst = true } = req.body;
      
      const result = await autoGenerateTimetable(lockExisting, clearFirst);
      res.json(result);
    } catch (error) {
      console.error("Auto-generate error:", error);
      res.status(500).json({ 
        success: false, 
        slotsPlaced: 0, 
        warnings: [],
        errors: ["Failed to auto-generate timetable: " + (error instanceof Error ? error.message : "Unknown error")]
      });
    }
  });

  return httpServer;
}

// ===== AUTO-GENERATION ALGORITHM =====

async function autoGenerateTimetable(lockExisting: boolean, clearFirst: boolean): Promise<AutoGenerateResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let slotsPlaced = 0;
  
  const teachers = await storage.getTeachers();
  const quotas = await storage.getSubjectQuotas();
  
  // Get existing slots to optionally preserve
  const existingTimetable = await storage.getTimetable();
  const lockedSlots = new Set<string>();
  
  if (lockExisting) {
    // Mark occupied slots as locked
    Array.from(existingTimetable.entries()).forEach(([key, slot]) => {
      if (slot.status === "occupied") {
        lockedSlots.add(key);
      }
    });
  }
  
  // Clear timetable if requested (but preserve locked slots)
  if (clearFirst && !lockExisting) {
    await storage.clearAllSlots();
  } else if (clearFirst && lockExisting) {
    // Clear only non-locked slots
    for (const entry of Array.from(existingTimetable.entries())) {
      const [key, slot] = entry;
      if (!lockedSlots.has(key) && slot.status === "occupied") {
        await storage.clearSlot(slot.day, slot.schoolClass, slot.period);
      }
    }
  }
  
  // Get fresh timetable state
  let timetable = await storage.getTimetable();
  
  // Build quota tracking per class
  const quotaTracker: Map<string, Map<string, number>> = new Map();
  for (const schoolClass of CLASSES) {
    const classQuotas = new Map<string, number>();
    for (const quota of quotas) {
      const required = getQuotaForClass(quota, schoolClass);
      if (required > 0) {
        classQuotas.set(quota.subject, required);
      }
    }
    quotaTracker.set(schoolClass, classQuotas);
  }
  
  // Reduce quotas by already placed slots
  Array.from(timetable.values()).forEach(slot => {
    if (slot.status === "occupied" && slot.subject) {
      const classQuotas = quotaTracker.get(slot.schoolClass);
      if (classQuotas) {
        const remaining = classQuotas.get(slot.subject) || 0;
        if (remaining > 0) {
          classQuotas.set(slot.subject, remaining - 1);
        }
        // Also count slash pair subject
        if (slot.slashPairSubject) {
          const pairRemaining = classQuotas.get(slot.slashPairSubject) || 0;
          if (pairRemaining > 0) {
            classQuotas.set(slot.slashPairSubject, pairRemaining - 1);
          }
        }
      }
    }
  });
  
  // Process each class
  for (const schoolClass of CLASSES) {
    const classQuotas = quotaTracker.get(schoolClass)!;
    const isSlashClass = usesSlashSubjects(schoolClass);
    
    // Schedule slash subjects first for SS2/SS3
    if (isSlashClass) {
      for (const slashPair of SLASH_SUBJECTS) {
        const [subj1, subj2] = slashPair.pair;
        const quota1 = classQuotas.get(subj1) || 0;
        const quota2 = classQuotas.get(subj2) || 0;
        const toSchedule = Math.min(quota1, quota2);
        
        if (toSchedule > 0) {
          const placed = await scheduleSlashSubject(
            schoolClass, subj1, subj2, toSchedule,
            teachers, timetable, lockedSlots, warnings
          );
          slotsPlaced += placed;
          classQuotas.set(subj1, quota1 - placed);
          classQuotas.set(subj2, quota2 - placed);
          timetable = await storage.getTimetable();
        }
      }
    }
    
    // Schedule remaining subjects
    const subjects = Array.from(classQuotas.entries())
      .filter(([_, remaining]) => remaining > 0)
      .sort((a, b) => b[1] - a[1]); // Priority: subjects needing more periods
    
    for (const [subject, remaining] of subjects) {
      const placed = await scheduleSingleSubject(
        schoolClass, subject, remaining,
        teachers, timetable, lockedSlots, warnings
      );
      slotsPlaced += placed;
      if (placed < remaining) {
        warnings.push(`${schoolClass}: Could only place ${placed}/${remaining} periods for ${subject}`);
      }
      timetable = await storage.getTimetable();
    }
  }
  
  // Summary
  const finalTimetable = await storage.getTimetable();
  let totalEmpty = 0;
  Array.from(finalTimetable.values()).forEach(slot => {
    if (slot.status === "empty") totalEmpty++;
  });
  
  if (totalEmpty > 0) {
    warnings.push(`${totalEmpty} slots remain empty`);
  }
  
  return {
    success: errors.length === 0,
    slotsPlaced,
    warnings,
    errors,
  };
}

async function scheduleSlashSubject(
  schoolClass: SchoolClass,
  subject1: string,
  subject2: string,
  count: number,
  teachers: Teacher[],
  timetable: Map<string, TimetableSlot>,
  lockedSlots: Set<string>,
  warnings: string[]
): Promise<number> {
  let placed = 0;
  
  // Find teachers for each subject (respecting subject-class mappings)
  const teachers1 = teachers.filter(t => 
    t.subjects.includes(subject1) && 
    t.classes.includes(schoolClass) &&
    getTeacherSubjectClasses(t, subject1).includes(schoolClass)
  );
  const teachers2 = teachers.filter(t => 
    t.subjects.includes(subject2) && 
    t.classes.includes(schoolClass) &&
    getTeacherSubjectClasses(t, subject2).includes(schoolClass)
  );
  
  if (teachers1.length === 0 || teachers2.length === 0) {
    warnings.push(`${schoolClass}: No teacher available for slash pair ${subject1}/${subject2}`);
    return 0;
  }
  
  for (let i = 0; i < count && placed < count; i++) {
    // Try each day/period combination
    let slotPlaced = false;
    
    for (const day of DAYS) {
      if (slotPlaced) break;
      const maxPeriods = PERIODS_PER_DAY[day];
      
      for (let period = 1; period <= maxPeriods; period++) {
        if (slotPlaced) break;
        const key = `${day}-${schoolClass}-${period}`;
        
        if (lockedSlots.has(key)) continue;
        const slot = timetable.get(key);
        if (slot && slot.status === "occupied") continue;
        
        // Try to find available teacher pair
        for (const t1 of teachers1) {
          if (slotPlaced) break;
          if (!isTeacherAvailableForSlot(timetable, t1, day, period)) continue;
          if (wouldExceedFatigue(timetable, t1.id, day, [period])) continue;
          
          for (const t2 of teachers2) {
            if (t1.id === t2.id) continue; // Same teacher can't teach both
            if (!isTeacherAvailableForSlot(timetable, t2, day, period)) continue;
            if (wouldExceedFatigue(timetable, t2.id, day, [period])) continue;
            
            // Check English-Security rule
            if (subject1 === "Security" || subject2 === "Security") {
              const prevKey = `${day}-${schoolClass}-${period - 1}`;
              const prevSlot = timetable.get(prevKey);
              if (prevSlot && prevSlot.subject === "English") continue;
            }
            
            // Place the slot
            const newSlot: TimetableSlot = {
              day,
              period,
              schoolClass,
              status: "occupied",
              subject: subject1,
              teacherId: t1.id,
              slotType: "slash",
              slashPairSubject: subject2,
              slashPairTeacherId: t2.id,
            };
            
            await storage.setSlot(newSlot);
            timetable.set(key, newSlot);
            placed++;
            slotPlaced = true;
            break;
          }
        }
      }
    }
  }
  
  return placed;
}

async function scheduleSingleSubject(
  schoolClass: SchoolClass,
  subject: string,
  count: number,
  teachers: Teacher[],
  timetable: Map<string, TimetableSlot>,
  lockedSlots: Set<string>,
  warnings: string[]
): Promise<number> {
  let placed = 0;
  
  // Find teachers for this subject and class (respecting subject-class mappings)
  const availableTeachers = teachers.filter(t => 
    t.subjects.includes(subject) && 
    t.classes.includes(schoolClass) &&
    getTeacherSubjectClasses(t, subject).includes(schoolClass)
  );
  
  if (availableTeachers.length === 0) {
    warnings.push(`${schoolClass}: No teacher available for ${subject}`);
    return 0;
  }
  
  for (let i = 0; i < count && placed < count; i++) {
    let slotPlaced = false;
    
    for (const day of DAYS) {
      if (slotPlaced) break;
      const maxPeriods = PERIODS_PER_DAY[day];
      
      for (let period = 1; period <= maxPeriods; period++) {
        if (slotPlaced) break;
        const key = `${day}-${schoolClass}-${period}`;
        
        if (lockedSlots.has(key)) continue;
        const slot = timetable.get(key);
        if (slot && slot.status === "occupied") continue;
        
        // Try each available teacher
        for (const teacher of availableTeachers) {
          if (!isTeacherAvailableForSlot(timetable, teacher, day, period)) continue;
          if (wouldExceedFatigue(timetable, teacher.id, day, [period])) continue;
          
          // Check English-Security rule
          if (subject === "Security") {
            const prevKey = `${day}-${schoolClass}-${period - 1}`;
            const prevSlot = timetable.get(prevKey);
            if (prevSlot && prevSlot.subject === "English") continue;
          }
          
          // Place the slot
          const newSlot: TimetableSlot = {
            day,
            period,
            schoolClass,
            status: "occupied",
            subject,
            teacherId: teacher.id,
            slotType: "single",
            slashPairSubject: null,
            slashPairTeacherId: null,
          };
          
          await storage.setSlot(newSlot);
          timetable.set(key, newSlot);
          placed++;
          slotPlaced = true;
          break;
        }
      }
    }
  }
  
  return placed;
}

function isTeacherAvailableForSlot(
  timetable: Map<string, TimetableSlot>,
  teacher: Teacher,
  day: Day,
  period: number
): boolean {
  // Check unavailability
  const unavailablePeriods = teacher.unavailable[day] || [];
  if (unavailablePeriods.includes(period)) return false;
  
  // Check if already teaching
  for (const schoolClass of CLASSES) {
    const key = `${day}-${schoolClass}-${period}`;
    const slot = timetable.get(key);
    if (slot && (slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id)) {
      return false;
    }
  }
  
  return true;
}

function wouldExceedFatigue(
  timetable: Map<string, TimetableSlot>,
  teacherId: string,
  day: Day,
  newPeriods: number[]
): boolean {
  const maxPeriods = PERIODS_PER_DAY[day];
  const teachingPeriods = new Set<number>(newPeriods);
  
  for (let period = 1; period <= maxPeriods; period++) {
    for (const schoolClass of CLASSES) {
      const key = `${day}-${schoolClass}-${period}`;
      const slot = timetable.get(key);
      if (slot && (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId)) {
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
  
  return maxConsecutive > 5;
}
