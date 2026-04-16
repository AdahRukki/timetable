import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import {
  insertTeacherSchema,
  insertSubjectSchema,
  placementRequestSchema,
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

// Get user ID from authenticated request
function getUserId(req: Request): string {
  return (req.user as any)?.claims?.sub;
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
    if (slot && (slot.subject === subject || slot.slashPairSubject === subject)) {
      count++;
    }
  }
  
  return count;
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
  userId: string,
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
  const teachers = await storage.getTeachers(userId);
  const timetable = await storage.getTimetable(userId);
  const userSettings = await storage.getUserSettings(userId);
  const fatigueLimit = userSettings.fatigueLimit;
  
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
  
  // Slash subject validation
  if (slotType === "slash") {
    if (!usesSlashSubjects(schoolClass)) {
      errors.push({
        code: "INVALID_SLASH",
        message: "Slash subjects are only allowed for SS2 and SS3",
        severity: "error",
      });
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
        if (slashConsecutive > fatigueLimit) {
          errors.push({
            code: "SLASH_TEACHER_FATIGUE",
            message: `${slashPairTeacher.name} would exceed ${fatigueLimit} consecutive teaching periods`,
            severity: "error",
          });
        }
      }
    }
  }
  
  // Fatigue limit check
  const periodsToAdd = slotType === "double" ? [period, period + 1] : [period];
  const consecutive = getConsecutiveTeachingCount(timetable, teacherId, day, periodsToAdd);
  if (consecutive > fatigueLimit) {
    errors.push({
      code: "FATIGUE_LIMIT",
      message: `${teacher.name} would exceed ${fatigueLimit} consecutive teaching periods`,
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
  
  // Subject can only appear once per day per class
  const dailySubjectCount = getTotalSubjectCountForDay(timetable, day, schoolClass, subject, []);
  if (dailySubjectCount >= 1) {
    errors.push({
      code: "SUBJECT_ALREADY_SCHEDULED",
      message: `${subject} is already scheduled for ${schoolClass} on ${day}`,
      severity: "error",
    });
  }
  
  // For slash subjects, also check the paired subject
  if (slashPairSubject) {
    const dailyPairCount = getTotalSubjectCountForDay(timetable, day, schoolClass, slashPairSubject, []);
    if (dailyPairCount >= 1) {
      errors.push({
        code: "SUBJECT_ALREADY_SCHEDULED",
        message: `${slashPairSubject} is already scheduled for ${schoolClass} on ${day}`,
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
      const result = await validatePlacement(
        userId,
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
  app.post("/api/timetable/place", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const data = placementRequestSchema.parse(req.body);
      
      const validation = await validatePlacement(
        userId,
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
      
      await storage.setSlot(userId, slot);
      
      if (data.slotType === "double") {
        const nextSlot: TimetableSlot = {
          ...slot,
          period: data.period + 1,
        };
        await storage.setSlot(userId, nextSlot);
      }
      
      await storage.addAction(userId, {
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
  app.delete("/api/timetable/:day/:class/:period", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const { day, class: schoolClass, period } = req.params;
    
    if (!DAYS.includes(day as Day) || !CLASSES.includes(schoolClass as SchoolClass)) {
      res.status(400).json({ error: "Invalid day or class" });
      return;
    }
    
    const cleared = await storage.clearSlot(
      userId,
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

  // Update subject quota
  app.patch("/api/quotas/:subject", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { subject } = req.params;
      
      const partialQuotaSchema = z.object({
        jssQuota: z.number().min(0).max(10).optional(),
        ss1Quota: z.number().min(0).max(10).optional(),
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

  // Reset quotas to defaults
  app.post("/api/quotas/reset", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const quotas = await storage.resetSubjectQuotas(userId);
    res.json(quotas);
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
        allowDoublePeriods: z.boolean().optional(),
        allowDoubleInP8P9: z.boolean().optional(),
      });
      const updates = settingsSchema.parse(req.body);
      const settings = await storage.updateUserSettings(userId, updates);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid settings data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update settings" });
      }
    }
  });

  // ===== Custom Subjects =====
  
  // Get all subjects
  app.get("/api/subjects", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    await storage.initializeUserData(userId);
    
    // Always ensure subjects table is synced with quotas for existing users
    await storage.initializeSubjectsFromQuotas(userId);
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
        ss1Quota: z.number().min(0).max(10).optional(),
        ss2ss3Quota: z.number().min(0).max(10).optional(),
        isSlashSubject: z.boolean().optional(),
        slashPairName: z.string().nullable().optional(),
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
      res.status(404).json({ error: "Subject not found or cannot be deleted" });
    }
  });

  // ===== Auto-Generation =====
  
  app.post("/api/timetable/autogenerate", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { lockExisting = false, clearFirst = true } = req.body;
      
      const result = await autoGenerateTimetable(userId, lockExisting, clearFirst);
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

  return httpServer;
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
  fatigueLimit: number
): boolean {
  const periodsToday = PERIODS_PER_DAY[day];
  const breaks = BREAK_AFTER[day];
  const teaching = new Set<number>(proposedPeriods);
  for (let p = 1; p <= periodsToday; p++) {
    for (const cls of CLASSES) {
      const slot = timetable.get(slotKey(day, cls, p));
      if (!slot || slot.status !== "occupied") continue;
      if (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId) {
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
  return maxConsecutive > fatigueLimit;
}

function violatesSecurityRule(timetable: Timetable, cls: SchoolClass, day: Day, period: number, subject: string): boolean {
  if (subject !== "Security") return false;
  if (period <= 1) return false;
  const prev = timetable.get(slotKey(day, cls, period - 1));
  return prev?.subject === "English";
}

function subjectAlreadyTodayForClass(timetable: Timetable, cls: SchoolClass, day: Day, subject: string): boolean {
  const periodsToday = PERIODS_PER_DAY[day];
  for (let p = 1; p <= periodsToday; p++) {
    const slot = timetable.get(slotKey(day, cls, p));
    if (slot?.status === "occupied" && slot.subject === subject) return true;
    if (slot?.status === "occupied" && slot.slashPairSubject === subject) return true;
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
  if (slotType === "double" && extraPeriod !== undefined) {
    const slot2 = timetable.get(slotKey(day, cls, extraPeriod))!;
    slot2.status = "occupied";
    slot2.subject = subject;
    slot2.teacherId = teacherId;
    slot2.slotType = "double";
    slot2.slashPairSubject = null;
    slot2.slashPairTeacherId = null;
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
  relaxDailyRule = false
): number {
  const slot = timetable.get(slotKey(day, cls, period));
  if (!slot || slot.status !== "empty") return 0;
  if (!relaxDailyRule && subjectAlreadyTodayForClass(timetable, cls, day, subject)) return 0;
  if (violatesSecurityRule(timetable, cls, day, period, subject)) return 0;
  if (isTeacherUnavailable(teacher, day, period)) return 0;
  if (!isTeacherFreeAt(timetable, teacher.id, day, period)) return 0;

  // Try double first
  if (allowDouble && period < PERIODS_PER_DAY[day] && !wouldCrossBreak(day, period)) {
    const next = period + 1;
    const slot2 = timetable.get(slotKey(day, cls, next));
    if (
      slot2?.status === "empty" &&
      !isTeacherUnavailable(teacher, day, next) &&
      isTeacherFreeAt(timetable, teacher.id, day, next) &&
      !wouldExceedFatigue(timetable, teacher.id, day, [period, next], fatigueLimit)
    ) {
      placeSlot(timetable, cls, day, period, subject, teacher.id, "double", next);
      return 2;
    }
  }

  // Single
  if (!wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit)) {
    placeSlot(timetable, cls, day, period, subject, teacher.id, "single");
    return 1;
  }
  return 0;
}

function scheduleSubject(
  timetable: Timetable,
  cls: SchoolClass,
  subject: string,
  needed: number,
  teachers: Teacher[],
  fatigueLimit: number,
  warnings: string[],
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
      for (const teacher of shuffle(eligible)) {
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

function scheduleSlashPair(
  timetable: Timetable,
  cls: SchoolClass,
  subject1: string,
  subject2: string,
  needed: number,
  teachers: Teacher[],
  fatigueLimit: number,
  warnings: string[]
): number {
  const t1List = teachers.filter(t => teacherCanTeachSubjectToClass(t, subject1, cls));
  const t2List = teachers.filter(t => teacherCanTeachSubjectToClass(t, subject2, cls));
  if (t1List.length === 0) { warnings.push(`No teacher for slash subject ${subject1} → ${cls}`); return 0; }
  if (t2List.length === 0) { warnings.push(`No teacher for slash subject ${subject2} → ${cls}`); return 0; }
  let placed = 0;
  const days = shuffle([...DAYS] as Day[]);
  for (const day of days) {
    if (placed >= needed) break;
    const periods = shuffle(Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1));
    for (const period of periods) {
      if (placed >= needed) break;
      if (subjectAlreadyTodayForClass(timetable, cls, day, subject1)) continue;
      if (subjectAlreadyTodayForClass(timetable, cls, day, subject2)) continue;
      const slot = timetable.get(slotKey(day, cls, period));
      if (!slot || slot.status !== "empty") continue;
      let found = false;
      for (const t1 of shuffle(t1List)) {
        if (isTeacherUnavailable(t1, day, period)) continue;
        if (!isTeacherFreeAt(timetable, t1.id, day, period)) continue;
        if (wouldExceedFatigue(timetable, t1.id, day, [period], fatigueLimit)) continue;
        for (const t2 of shuffle(t2List)) {
          if (t2.id === t1.id) continue;
          if (isTeacherUnavailable(t2, day, period)) continue;
          if (!isTeacherFreeAt(timetable, t2.id, day, period)) continue;
          if (wouldExceedFatigue(timetable, t2.id, day, [period], fatigueLimit)) continue;
          if (subject1 === "Security" || subject2 === "Security") {
            const prev = timetable.get(slotKey(day, cls, period - 1));
            if (prev?.subject === "English") continue;
          }
          slot.status = "occupied";
          slot.subject = subject1;
          slot.teacherId = t1.id;
          slot.slotType = "slash";
          slot.slashPairSubject = subject2;
          slot.slashPairTeacherId = t2.id;
          placed++;
          found = true;
          break;
        }
        if (found) break;
      }
    }
  }
  return placed;
}

function countEmpty(timetable: Timetable): number {
  let count = 0;
  for (const slot of timetable.values()) {
    if (slot.status === "empty") count++;
  }
  return count;
}

function countPlacements(timetable: Timetable, cls: SchoolClass, subject: string): number {
  let count = 0;
  for (const slot of timetable.values()) {
    if (slot.schoolClass !== cls || slot.status !== "occupied") continue;
    if (slot.subject === subject) count++;
    if (slot.slashPairSubject === subject) count++;
  }
  return count;
}

function removeExcess(timetable: Timetable, cls: SchoolClass, subject: string, excess: number): void {
  const toRemove: string[] = [];
  for (const day of [...DAYS].reverse() as Day[]) {
    for (let p = PERIODS_PER_DAY[day]; p >= 1; p--) {
      const key = slotKey(day, cls, p);
      const slot = timetable.get(key);
      if (!slot || slot.status !== "occupied") continue;
      if (slot.subject === subject || slot.slashPairSubject === subject) toRemove.push(key);
    }
  }
  let removed = 0;
  for (const key of toRemove) {
    if (removed >= excess) break;
    const slot = timetable.get(key)!;
    slot.status = "empty";
    slot.subject = null;
    slot.teacherId = null;
    slot.slotType = null;
    slot.slashPairSubject = null;
    slot.slashPairTeacherId = null;
    removed++;
  }
}

function swapRepairPass(
  timetable: Timetable,
  cls: SchoolClass,
  subject: string,
  teacher: Teacher,
  fatigueLimit: number,
  _warnings: string[]
): number {
  for (const day of shuffle([...DAYS] as Day[])) {
    if (subjectAlreadyTodayForClass(timetable, cls, day, subject)) continue;
    for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
      const targetKey = slotKey(day, cls, p);
      const targetSlot = timetable.get(targetKey);
      if (!targetSlot || targetSlot.status !== "occupied") continue;
      if (targetSlot.slotType === "slash") continue;
      const existingSubject = targetSlot.subject!;
      const existingTeacherId = targetSlot.teacherId!;
      for (const altDay of shuffle([...DAYS] as Day[])) {
        if (altDay === day) continue;
        if (subjectAlreadyTodayForClass(timetable, cls, altDay, existingSubject)) continue;
        for (let altP = 1; altP <= PERIODS_PER_DAY[altDay]; altP++) {
          const altKey = slotKey(altDay, cls, altP);
          const altSlot = timetable.get(altKey);
          if (!altSlot || altSlot.status !== "empty") continue;
          if (!isTeacherFreeAt(timetable, existingTeacherId, altDay, altP)) continue;
          const savedStatus = targetSlot.status;
          const savedSubject = targetSlot.subject;
          const savedTeacherId = targetSlot.teacherId;
          const savedSlotType = targetSlot.slotType;
          targetSlot.status = "empty";
          targetSlot.subject = null;
          targetSlot.teacherId = null;
          targetSlot.slotType = null;
          const canPlace =
            !isTeacherUnavailable(teacher, day, p) &&
            isTeacherFreeAt(timetable, teacher.id, day, p) &&
            !wouldExceedFatigue(timetable, teacher.id, day, [p], fatigueLimit) &&
            !violatesSecurityRule(timetable, cls, day, p, subject);
          if (canPlace) {
            altSlot.status = "occupied";
            altSlot.subject = existingSubject;
            altSlot.teacherId = existingTeacherId;
            altSlot.slotType = "single";
            altSlot.slashPairSubject = null;
            altSlot.slashPairTeacherId = null;
            targetSlot.status = "occupied";
            targetSlot.subject = subject;
            targetSlot.teacherId = teacher.id;
            targetSlot.slotType = "single";
            targetSlot.slashPairSubject = null;
            targetSlot.slashPairTeacherId = null;
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

function preValidate(teachers: Teacher[], quotas: SubjectQuota[], warnings: string[]): void {
  const JSS_CLASSES: SchoolClass[] = ["JSS1", "JSS2", "JSS3"];
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      if (needed === 0) continue;
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
          });
        }
      }
    }
  }
  return timetable;
}

function runAttempt(
  teachers: Teacher[],
  quotas: SubjectQuota[],
  lockedSlots: Timetable,
  fatigueLimit: number,
  attemptNumber: number
): { timetable: Timetable; emptyCount: number; warnings: string[] } {
  const timetable = initTimetable(lockedSlots);
  const warnings: string[] = [];

  // PHASE 1: Slash subjects for SS2 & SS3
  for (const slashPair of SLASH_SUBJECTS) {
    for (const cls of ["SS2", "SS3"] as SchoolClass[]) {
      const placed = scheduleSlashPair(
        timetable, cls,
        slashPair.pair[0], slashPair.pair[1],
        slashPair.periods,
        teachers, fatigueLimit, warnings
      );
      if (placed < slashPair.periods) {
        warnings.push(`Attempt ${attemptNumber}: Slash ${slashPair.pair.join("/")} → ${cls}: placed ${placed}/${slashPair.periods}`);
      }
    }
  }

  // PHASE 2: Build assignment list, bottleneck teachers first
  type Assignment = { subject: string; cls: SchoolClass; needed: number };
  const assignments: Assignment[] = [];

  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      if (needed === 0) continue;
      if (quota.isSlashSubject && (cls === "SS2" || cls === "SS3")) continue;
      const eligible = teachers.filter(t => teacherCanTeachSubjectToClass(t, quota.subject, cls));
      if (eligible.length === 0) continue;
      const alreadyPlaced = countPlacements(timetable, cls, quota.subject);
      const remaining = needed - alreadyPlaced;
      if (remaining > 0) {
        assignments.push({ subject: quota.subject, cls, needed: remaining });
      }
    }
  }

  // Count teacher availability for bottleneck ordering
  const teacherAvailCount = new Map<string, number>();
  for (const t of teachers) {
    let avail = 0;
    for (const day of DAYS) {
      for (let p = 1; p <= PERIODS_PER_DAY[day]; p++) {
        if (!isTeacherUnavailable(t, day, p)) avail++;
      }
    }
    teacherAvailCount.set(t.id, avail);
  }

  const shuffledAssignments = shuffle(assignments);
  shuffledAssignments.sort((a, b) => {
    const aEligible = teachers.filter(t => teacherCanTeachSubjectToClass(t, a.subject, a.cls));
    const bEligible = teachers.filter(t => teacherCanTeachSubjectToClass(t, b.subject, b.cls));
    const aAvail = Math.min(...aEligible.map(t => teacherAvailCount.get(t.id) ?? 999));
    const bAvail = Math.min(...bEligible.map(t => teacherAvailCount.get(t.id) ?? 999));
    if (aAvail !== bAvail) return aAvail - bAvail;
    return b.needed - a.needed;
  });

  // PHASE 3: Schedule each assignment
  for (const { subject, cls, needed } of shuffledAssignments) {
    const alreadyPlaced = countPlacements(timetable, cls, subject);
    const remaining = needed - alreadyPlaced;
    if (remaining <= 0) continue;
    scheduleSubject(timetable, cls, subject, remaining, teachers, fatigueLimit, warnings, false);
  }

  // PHASE 4: Retry passes (up to 3) with relaxed daily rule
  for (let pass = 0; pass < 3; pass++) {
    let anyProgress = false;
    for (const cls of shuffle([...CLASSES] as SchoolClass[])) {
      for (const quota of shuffle(quotas)) {
        const needed = getQuotaForClass(quota, cls);
        if (needed === 0) continue;
        if (quota.isSlashSubject && (cls === "SS2" || cls === "SS3")) continue;
        const alreadyPlaced = countPlacements(timetable, cls, quota.subject);
        const remaining = needed - alreadyPlaced;
        if (remaining <= 0) continue;
        const p = scheduleSubject(timetable, cls, quota.subject, remaining, teachers, fatigueLimit, warnings, true);
        if (p > 0) anyProgress = true;
      }
    }
    if (!anyProgress) break;
  }

  // PHASE 5: Swap repair for subjects still short
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      if (needed === 0) continue;
      if (quota.isSlashSubject && (cls === "SS2" || cls === "SS3")) continue;
      const alreadyPlaced = countPlacements(timetable, cls, quota.subject);
      if (alreadyPlaced >= needed) continue;
      const eligible = teachers.filter(t => teacherCanTeachSubjectToClass(t, quota.subject, cls));
      for (const teacher of shuffle(eligible)) {
        const repaired = swapRepairPass(timetable, cls, quota.subject, teacher, fatigueLimit, warnings);
        if (repaired > 0) break;
      }
    }
  }

  // PHASE 6: Remove excess (over-quota)
  for (const cls of CLASSES) {
    for (const quota of quotas) {
      const needed = getQuotaForClass(quota, cls);
      const placed = countPlacements(timetable, cls, quota.subject);
      if (placed > needed) removeExcess(timetable, cls, quota.subject, placed - needed);
    }
  }

  return { timetable, emptyCount: countEmpty(timetable), warnings };
}

const MAX_ATTEMPTS = 12;
const EARLY_EXIT_EMPTY = 3;

async function autoGenerateTimetable(userId: string, lockExisting: boolean, clearFirst: boolean): Promise<AutoGenerateResult> {
  const teachers = await storage.getTeachers(userId);
  const quotas = await storage.getSubjectQuotas(userId);
  const userSettings = await storage.getUserSettings(userId);
  const fatigueLimit = userSettings.fatigueLimit;

  // Load existing timetable to determine locked slots
  const existingTimetable = await storage.getTimetable(userId);
  const lockedSlots: Timetable = new Map();

  if (lockExisting) {
    for (const [key, slot] of Array.from(existingTimetable.entries())) {
      if (slot.status === "occupied") {
        lockedSlots.set(key, { ...slot });
      }
    }
  }

  // Pre-validate: warn about impossible assignments before wasting attempts
  const preWarnings: string[] = [];
  preValidate(teachers, quotas, preWarnings);

  // Run up to MAX_ATTEMPTS fully in-memory, pick the attempt with fewest empty slots
  let best: { timetable: Timetable; emptyCount: number; warnings: string[] } | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = runAttempt(teachers, quotas, lockedSlots, fatigueLimit, attempt);
    if (!best || result.emptyCount < best.emptyCount) {
      best = result;
    }
    if (best.emptyCount <= EARLY_EXIT_EMPTY) break;
  }

  if (!best) {
    return { success: false, slotsPlaced: 0, warnings: preWarnings, errors: ["Failed to generate timetable"] };
  }

  // Write best result to DB in a single pass
  await storage.clearAllSlots(userId);
  let slotsPlaced = 0;
  for (const slot of Array.from(best.timetable.values())) {
    if (slot.status === "occupied") {
      await storage.setSlot(userId, slot);
      slotsPlaced++;
    }
  }

  const allWarnings = [...preWarnings, ...best.warnings];
  if (best.emptyCount > 0) {
    allWarnings.push(`${best.emptyCount} slot(s) remain empty after ${MAX_ATTEMPTS} attempts`);
  }

  return {
    success: true,
    slotsPlaced,
    warnings: allWarnings,
    errors: [],
  };
}
