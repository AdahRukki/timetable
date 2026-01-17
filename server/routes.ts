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

  return httpServer;
}

// ===== AUTO-GENERATION ALGORITHM (Multi-Attempt with Randomization) =====

interface TeacherAssignment {
  teacher: Teacher;
  subject: string;
  schoolClass: SchoolClass;
  periodsNeeded: number;
}

// Shuffle array utility
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function autoGenerateTimetable(userId: string, lockExisting: boolean, clearFirst: boolean): Promise<AutoGenerateResult> {
  const teachers = await storage.getTeachers(userId);
  const quotas = await storage.getSubjectQuotas(userId);
  const userSettings = await storage.getUserSettings(userId);
  const fatigueLimit = userSettings.fatigueLimit;
  
  // Get existing slots to optionally preserve
  const existingTimetable = await storage.getTimetable(userId);
  const lockedSlots = new Set<string>();
  
  if (lockExisting) {
    Array.from(existingTimetable.entries()).forEach(([key, slot]) => {
      if (slot.status === "occupied") {
        lockedSlots.add(key);
      }
    });
  }
  
  // Try multiple generation attempts with different randomizations
  const NUM_ATTEMPTS = 8;
  let bestAttempt: { slots: Map<string, TimetableSlot>; slotsPlaced: number; warnings: string[] } | null = null;
  let bestEmptyCount = Infinity;
  
  for (let attempt = 0; attempt < NUM_ATTEMPTS; attempt++) {
    // Clear timetable for this attempt (but preserve locked slots)
    if (clearFirst && !lockExisting) {
      await storage.clearAllSlots(userId);
    } else if (clearFirst && lockExisting) {
      for (const entry of Array.from(existingTimetable.entries())) {
        const [key, slot] = entry;
        if (!lockedSlots.has(key) && slot.status === "occupied") {
          await storage.clearSlot(userId, slot.day, slot.schoolClass, slot.period);
        }
      }
    } else if (attempt > 0) {
      // For subsequent attempts, clear non-locked slots
      const currentTimetable = await storage.getTimetable(userId);
      for (const entry of Array.from(currentTimetable.entries())) {
        const [key, slot] = entry;
        if (!lockedSlots.has(key) && slot.status === "occupied") {
          await storage.clearSlot(userId, slot.day, slot.schoolClass, slot.period);
        }
      }
    }
    
    // Run a single generation attempt with randomization
    const attemptResult = await runSingleGenerationAttempt(
      userId, teachers, quotas, lockedSlots, fatigueLimit, attempt
    );
    
    // Count empty slots in this attempt
    const attemptTimetable = await storage.getTimetable(userId);
    let emptyCount = 0;
    for (const day of DAYS) {
      const maxPeriods = PERIODS_PER_DAY[day];
      for (const schoolClass of CLASSES) {
        for (let period = 1; period <= maxPeriods; period++) {
          const key = `${day}-${schoolClass}-${period}`;
          const slot = attemptTimetable.get(key);
          if (!slot || slot.status !== "occupied") {
            emptyCount++;
          }
        }
      }
    }
    
    // Track best attempt
    if (emptyCount < bestEmptyCount) {
      bestEmptyCount = emptyCount;
      bestAttempt = {
        slots: new Map(attemptTimetable),
        slotsPlaced: attemptResult.slotsPlaced,
        warnings: attemptResult.warnings,
      };
      
      // If we achieved a perfect or near-perfect fill, stop early
      if (emptyCount <= 5) break;
    }
  }
  
  // Restore best attempt to database
  if (bestAttempt) {
    // Clear and restore best result
    await storage.clearAllSlots(userId);
    for (const [key, slot] of Array.from(bestAttempt.slots.entries())) {
      if (slot.status === "occupied") {
        await storage.setSlot(userId, slot);
      }
    }
    
    if (bestEmptyCount > 0) {
      bestAttempt.warnings.push(`${bestEmptyCount} slots remain empty (best of ${NUM_ATTEMPTS} attempts)`);
    }
    
    return {
      success: true,
      slotsPlaced: bestAttempt.slotsPlaced,
      warnings: bestAttempt.warnings,
      errors: [],
    };
  }
  
  return {
    success: false,
    slotsPlaced: 0,
    warnings: [],
    errors: ["Failed to generate any valid timetable"],
  };
}

// Single generation attempt with randomization
async function runSingleGenerationAttempt(
  userId: string,
  teachers: Teacher[],
  quotas: any[],
  lockedSlots: Set<string>,
  fatigueLimit: number,
  attemptNumber: number
): Promise<{ slotsPlaced: number; warnings: string[] }> {
  const warnings: string[] = [];
  let slotsPlaced = 0;
  
  // Get fresh timetable state
  let timetable = await storage.getTimetable(userId);
  
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
        if (slot.slashPairSubject) {
          const pairRemaining = classQuotas.get(slot.slashPairSubject) || 0;
          if (pairRemaining > 0) {
            classQuotas.set(slot.slashPairSubject, pairRemaining - 1);
          }
        }
      }
    }
  });
  
  // ===== PHASE 1: Schedule slash subjects for SS2/SS3 =====
  for (const schoolClass of CLASSES) {
    if (!usesSlashSubjects(schoolClass)) continue;
    
    const classQuotas = quotaTracker.get(schoolClass)!;
    for (const slashPair of SLASH_SUBJECTS) {
      const [subj1, subj2] = slashPair.pair;
      const quota1 = classQuotas.get(subj1) || 0;
      const quota2 = classQuotas.get(subj2) || 0;
      const toSchedule = Math.min(quota1, quota2);
      
      if (toSchedule > 0) {
        const placed = await scheduleSlashSubject(
          userId, schoolClass, subj1, subj2, toSchedule,
          teachers, timetable, lockedSlots, warnings, fatigueLimit
        );
        slotsPlaced += placed;
        classQuotas.set(subj1, quota1 - placed);
        classQuotas.set(subj2, quota2 - placed);
        timetable = await storage.getTimetable(userId);
      }
    }
  }
  
  // ===== PHASE 2: Build teacher assignments =====
  // For each teacher, determine what they need to teach
  const teacherAssignments: TeacherAssignment[] = [];
  
  for (const teacher of teachers) {
    for (const subject of teacher.subjects) {
      const assignedClasses = getTeacherSubjectClasses(teacher, subject);
      for (const schoolClass of assignedClasses) {
        if (!teacher.classes.includes(schoolClass)) continue;
        
        const classQuotas = quotaTracker.get(schoolClass);
        if (!classQuotas) continue;
        
        const periodsNeeded = classQuotas.get(subject) || 0;
        if (periodsNeeded > 0) {
          teacherAssignments.push({
            teacher,
            subject,
            schoolClass,
            periodsNeeded,
          });
        }
      }
    }
  }
  
  // Sort assignments with randomization for variety between attempts
  const teacherLoadCount = new Map<string, number>();
  for (const assignment of teacherAssignments) {
    const current = teacherLoadCount.get(assignment.teacher.id) || 0;
    teacherLoadCount.set(assignment.teacher.id, current + assignment.periodsNeeded);
  }
  
  // First shuffle to randomize, then sort by priority
  // Different attempts will have different orderings
  const shuffledAssignments = shuffleArray(teacherAssignments);
  
  shuffledAssignments.sort((a, b) => {
    const loadA = teacherLoadCount.get(a.teacher.id) || 0;
    const loadB = teacherLoadCount.get(b.teacher.id) || 0;
    // Add some randomness to break ties
    const tieBreaker = (attemptNumber % 3) - 1; // -1, 0, or 1
    if (Math.abs(loadB - loadA) <= 2) return tieBreaker;
    // Teachers with higher loads first (they need more scheduling priority)
    if (loadB !== loadA) return loadB - loadA;
    // Then by periods needed
    return b.periodsNeeded - a.periodsNeeded;
  });
  
  // Replace original with shuffled
  teacherAssignments.length = 0;
  teacherAssignments.push(...shuffledAssignments);
  
  // ===== PHASE 3: Teacher-focused scheduling =====
  // Build set of slash subject names for quick lookup
  const slashSubjectNames = new Set<string>();
  for (const slashPair of SLASH_SUBJECTS) {
    slashSubjectNames.add(slashPair.pair[0]);
    slashSubjectNames.add(slashPair.pair[1]);
  }
  
  // Process each teacher assignment, distributing across days
  for (const assignment of teacherAssignments) {
    const { teacher, subject, schoolClass } = assignment;
    const classQuotas = quotaTracker.get(schoolClass)!;
    
    // Re-read remaining quota from tracker (another teacher may have placed some)
    let periodsToPlace = classQuotas.get(subject) || 0;
    
    if (periodsToPlace <= 0) continue;
    
    // Skip slash subjects for SS2/SS3 - they're handled in Phase 1 only
    if (usesSlashSubjects(schoolClass) && slashSubjectNames.has(subject)) {
      if (periodsToPlace > 0) {
        warnings.push(`${schoolClass}: ${subject} is a slash subject - ${periodsToPlace} period(s) could not be paired`);
      }
      continue;
    }
    
    // Track which days we've used for this subject-class combo (for daily distribution)
    const daysUsed = new Set<Day>();
    
    // Check existing placements for this subject-class
    for (const [_, slot] of Array.from(timetable.entries())) {
      if (slot.schoolClass === schoolClass && slot.subject === subject) {
        daysUsed.add(slot.day);
      }
    }
    
    // Try to place periods, spreading across different days
    // Strictly enforce: one subject per day per class (no exceptions)
    while (periodsToPlace > 0) {
      let placed = false;
      
      // Only try days where this subject hasn't been scheduled yet
      // Shuffle days to create variety between attempts
      const availableDays = shuffleArray(DAYS.filter(d => !daysUsed.has(d)));
      
      // If no available days, we cannot place more periods for this subject
      if (availableDays.length === 0) {
        if (periodsToPlace > 0) {
          warnings.push(`${schoolClass}: Cannot place ${periodsToPlace} more period(s) for ${subject} - all 5 days already used`);
        }
        break;
      }
      
      // Try double period first if we need 2+ periods
      if (periodsToPlace >= 2) {
        for (const day of availableDays) {
          if (placed) break;
          
          const maxPeriods = PERIODS_PER_DAY[day];
          // Generate and shuffle period list for variety
          const periodsToTry = shuffleArray(Array.from({ length: maxPeriods - 1 }, (_, i) => i + 1));
          
          for (const period of periodsToTry) {
            if (placed) break;
            
            // Double period validation
            if (wouldCrossBreak(day, period)) continue;
            
            const key1 = `${day}-${schoolClass}-${period}`;
            const key2 = `${day}-${schoolClass}-${period + 1}`;
            
            if (lockedSlots.has(key1) || lockedSlots.has(key2)) continue;
            
            const slot1 = timetable.get(key1);
            const slot2 = timetable.get(key2);
            if ((slot1 && slot1.status === "occupied") || (slot2 && slot2.status === "occupied")) continue;
            
            // Check teacher availability
            const unavailable = teacher.unavailable[day] || [];
            if (unavailable.includes(period) || unavailable.includes(period + 1)) continue;
            
            // Check teacher not teaching elsewhere at these periods
            if (!isTeacherFreeAt(timetable, teacher.id, day, period)) continue;
            if (!isTeacherFreeAt(timetable, teacher.id, day, period + 1)) continue;
            
            // Check fatigue
            if (wouldExceedFatigue(timetable, teacher.id, day, [period, period + 1], fatigueLimit)) continue;
            
            // Security rule
            if (subject === "Security") {
              const prevKey = `${day}-${schoolClass}-${period - 1}`;
              const prevSlot = timetable.get(prevKey);
              if (prevSlot && prevSlot.subject === "English") continue;
            }
            
            // Place double period
            const newSlot1: TimetableSlot = {
              day, period, schoolClass,
              status: "occupied",
              subject,
              teacherId: teacher.id,
              slotType: "double",
              slashPairSubject: null,
              slashPairTeacherId: null,
            };
            const newSlot2: TimetableSlot = {
              day, period: period + 1, schoolClass,
              status: "occupied",
              subject,
              teacherId: teacher.id,
              slotType: "double",
              slashPairSubject: null,
              slashPairTeacherId: null,
            };
            
            await storage.setSlot(userId, newSlot1);
            await storage.setSlot(userId, newSlot2);
            timetable.set(key1, newSlot1);
            timetable.set(key2, newSlot2);
            
            periodsToPlace -= 2;
            classQuotas.set(subject, periodsToPlace);
            slotsPlaced += 2;
            daysUsed.add(day);
            placed = true;
          }
        }
      }
      
      // If double didn't work, try single period
      if (!placed) {
        for (const day of availableDays) {
          if (placed) break;
          
          const maxPeriods = PERIODS_PER_DAY[day];
          // Generate and shuffle period list for variety
          const singlePeriodsToTry = shuffleArray(Array.from({ length: maxPeriods }, (_, i) => i + 1));
          
          for (const period of singlePeriodsToTry) {
            if (placed) break;
            
            const key = `${day}-${schoolClass}-${period}`;
            if (lockedSlots.has(key)) continue;
            
            const slot = timetable.get(key);
            if (slot && slot.status === "occupied") continue;
            
            // Check teacher availability
            const unavailable = teacher.unavailable[day] || [];
            if (unavailable.includes(period)) continue;
            
            // Check teacher not teaching elsewhere
            if (!isTeacherFreeAt(timetable, teacher.id, day, period)) continue;
            
            // Check fatigue
            if (wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit)) continue;
            
            // Security rule
            if (subject === "Security") {
              const prevKey = `${day}-${schoolClass}-${period - 1}`;
              const prevSlot = timetable.get(prevKey);
              if (prevSlot && prevSlot.subject === "English") continue;
            }
            
            // Place single period
            const newSlot: TimetableSlot = {
              day, period, schoolClass,
              status: "occupied",
              subject,
              teacherId: teacher.id,
              slotType: "single",
              slashPairSubject: null,
              slashPairTeacherId: null,
            };
            
            await storage.setSlot(userId, newSlot);
            timetable.set(key, newSlot);
            
            periodsToPlace -= 1;
            classQuotas.set(subject, periodsToPlace);
            slotsPlaced += 1;
            daysUsed.add(day);
            placed = true;
          }
        }
      }
      
      // If we couldn't place anything, break to avoid infinite loop
      if (!placed) {
        if (periodsToPlace > 0) {
          warnings.push(`${schoolClass}: Could not place ${periodsToPlace} period(s) for ${subject} (Teacher: ${teacher.name})`);
        }
        break;
      }
    }
  }
  
  // ===== PHASE 4: Report unfulfilled quotas =====
  for (const schoolClass of CLASSES) {
    const classQuotas = quotaTracker.get(schoolClass)!;
    for (const [subject, remaining] of Array.from(classQuotas.entries())) {
      if (remaining > 0) {
        // Check if any teacher can teach this
        const canTeach = teachers.some(t => 
          t.subjects.includes(subject) && 
          t.classes.includes(schoolClass) &&
          getTeacherSubjectClasses(t, subject).includes(schoolClass)
        );
        if (!canTeach) {
          warnings.push(`${schoolClass}: No teacher assigned to teach ${subject} - ${remaining} period(s) unfilled`);
        }
      }
    }
  }
  
  // ===== PHASE 5: Retry to fill remaining empty slots =====
  // This phase aggressively tries to fill any remaining empty slots
  // by relaxing the daily occurrence constraint and trying all available subjects
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    retryCount++;
    let filledInRetry = 0;
    timetable = await storage.getTimetable(userId);
    
    // Find all empty slots
    const emptySlots: Array<{ day: Day; schoolClass: SchoolClass; period: number }> = [];
    for (const day of DAYS) {
      const maxPeriods = PERIODS_PER_DAY[day];
      for (const schoolClass of CLASSES) {
        for (let period = 1; period <= maxPeriods; period++) {
          const key = `${day}-${schoolClass}-${period}`;
          if (lockedSlots.has(key)) continue;
          const slot = timetable.get(key);
          if (!slot || slot.status !== "occupied") {
            emptySlots.push({ day, schoolClass, period });
          }
        }
      }
    }
    
    if (emptySlots.length === 0) break;
    
    // Shuffle empty slots for variety
    for (let i = emptySlots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [emptySlots[i], emptySlots[j]] = [emptySlots[j], emptySlots[i]];
    }
    
    // Try to fill each empty slot
    for (const { day, schoolClass, period } of emptySlots) {
      const key = `${day}-${schoolClass}-${period}`;
      
      // Re-check if slot is still empty
      const currentSlot = timetable.get(key);
      if (currentSlot && currentSlot.status === "occupied") continue;
      
      const classQuotas = quotaTracker.get(schoolClass)!;
      
      // Get subjects with remaining quota for this class
      const subjectsWithQuota: Array<{ subject: string; remaining: number }> = [];
      for (const [subject, remaining] of Array.from(classQuotas.entries())) {
        if (remaining > 0) {
          // Skip slash subjects for SS2/SS3 in retry phase
          if (usesSlashSubjects(schoolClass) && slashSubjectNames.has(subject)) continue;
          subjectsWithQuota.push({ subject, remaining });
        }
      }
      
      // Sort by remaining quota (higher first)
      subjectsWithQuota.sort((a, b) => b.remaining - a.remaining);
      
      let placed = false;
      
      for (const { subject } of subjectsWithQuota) {
        if (placed) break;
        
        // STRICT QUOTA CHECK: Re-verify quota before attempting to place
        const currentQuota = classQuotas.get(subject) || 0;
        if (currentQuota <= 0) continue; // Skip if quota exhausted
        
        // Find teachers who can teach this subject to this class
        const availableTeachers = teachers.filter(t =>
          t.subjects.includes(subject) &&
          t.classes.includes(schoolClass) &&
          getTeacherSubjectClasses(t, subject).includes(schoolClass)
        );
        
        for (const teacher of availableTeachers) {
          if (placed) break;
          
          // Double-check quota hasn't been exhausted
          const quotaCheck = classQuotas.get(subject) || 0;
          if (quotaCheck <= 0) break;
          
          // Check teacher unavailability
          const unavailable = teacher.unavailable[day] || [];
          if (unavailable.includes(period)) continue;
          
          // Check teacher not teaching elsewhere
          if (!isTeacherFreeAt(timetable, teacher.id, day, period)) continue;
          
          // Check fatigue
          if (wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit)) continue;
          
          // Security rule
          if (subject === "Security") {
            const prevKey = `${day}-${schoolClass}-${period - 1}`;
            const prevSlot = timetable.get(prevKey);
            if (prevSlot && prevSlot.subject === "English") continue;
          }
          
          // Place the period
          const newSlot: TimetableSlot = {
            day, period, schoolClass,
            status: "occupied",
            subject,
            teacherId: teacher.id,
            slotType: "single",
            slashPairSubject: null,
            slashPairTeacherId: null,
          };
          
          await storage.setSlot(userId, newSlot);
          timetable.set(key, newSlot);
          
          classQuotas.set(subject, quotaCheck - 1);
          slotsPlaced++;
          filledInRetry++;
          placed = true;
        }
      }
    }
    
    // If no slots were filled in this retry, stop trying
    if (filledInRetry === 0) break;
  }
  
  // ===== FINAL VALIDATION: Ensure no subject exceeds quota =====
  // Count actual placements and compare against original quotas
  timetable = await storage.getTimetable(userId);
  
  // Rebuild original quotas for comparison
  const originalQuotas: Map<string, Map<string, number>> = new Map();
  for (const schoolClass of CLASSES) {
    const classQuotas = new Map<string, number>();
    for (const quota of quotas) {
      const required = getQuotaForClass(quota, schoolClass);
      if (required > 0) {
        classQuotas.set(quota.subject, required);
      }
    }
    originalQuotas.set(schoolClass, classQuotas);
  }
  
  // Count actual placements per subject per class
  const actualCounts: Map<string, Map<string, number>> = new Map();
  for (const schoolClass of CLASSES) {
    actualCounts.set(schoolClass, new Map<string, number>());
  }
  
  for (const slot of Array.from(timetable.values())) {
    if (slot.status === "occupied" && slot.subject) {
      const classCounts = actualCounts.get(slot.schoolClass)!;
      const current = classCounts.get(slot.subject) || 0;
      classCounts.set(slot.subject, current + 1);
      
      // Also count slash pair subjects
      if (slot.slashPairSubject) {
        const pairCurrent = classCounts.get(slot.slashPairSubject) || 0;
        classCounts.set(slot.slashPairSubject, pairCurrent + 1);
      }
    }
  }
  
  // Remove excess placements where subject exceeds quota
  for (const schoolClass of CLASSES) {
    const classOriginalQuotas = originalQuotas.get(schoolClass)!;
    const classCounts = actualCounts.get(schoolClass)!;
    
    for (const [subject, actualCount] of Array.from(classCounts.entries())) {
      const quota = classOriginalQuotas.get(subject) || 0;
      if (actualCount > quota && quota > 0) {
        // Find and remove excess slots (starting from later periods)
        let toRemove = actualCount - quota;
        warnings.push(`${schoolClass}: ${subject} exceeded quota (${actualCount}/${quota}), removing ${toRemove} excess`);
        
        // Collect slots for this subject in this class, sorted by period descending
        // For double periods, only include the first slot to avoid duplicate processing
        const subjectSlots: Array<{ day: Day; period: number; key: string; isDouble: boolean }> = [];
        const processedKeys = new Set<string>();
        
        for (const [key, slot] of Array.from(timetable.entries())) {
          if (slot.schoolClass === schoolClass && slot.subject === subject && slot.slotType !== "slash") {
            if (processedKeys.has(key)) continue;
            
            if (slot.slotType === "double") {
              // Check if this is the first slot of the double period
              const prevKey = `${slot.day}-${schoolClass}-${slot.period - 1}`;
              const prevSlot = timetable.get(prevKey);
              if (prevSlot && prevSlot.subject === subject && prevSlot.slotType === "double") {
                // This is the second slot of a double, skip it
                continue;
              }
              // This is the first slot of the double
              const nextKey = `${slot.day}-${schoolClass}-${slot.period + 1}`;
              processedKeys.add(key);
              processedKeys.add(nextKey);
              subjectSlots.push({ day: slot.day, period: slot.period, key, isDouble: true });
            } else {
              processedKeys.add(key);
              subjectSlots.push({ day: slot.day, period: slot.period, key, isDouble: false });
            }
          }
        }
        
        // Sort by period descending (remove later periods first)
        subjectSlots.sort((a, b) => b.period - a.period);
        
        for (const { day, period, key, isDouble } of subjectSlots) {
          if (toRemove <= 0) break;
          
          if (isDouble) {
            // Remove both slots of double period
            await storage.clearSlot(userId, day, schoolClass, period);
            timetable.delete(key);
            const nextKey = `${day}-${schoolClass}-${period + 1}`;
            await storage.clearSlot(userId, day, schoolClass, period + 1);
            timetable.delete(nextKey);
            toRemove -= 2;
            slotsPlaced -= 2;
          } else {
            await storage.clearSlot(userId, day, schoolClass, period);
            timetable.delete(key);
            toRemove -= 1;
            slotsPlaced -= 1;
          }
        }
      }
    }
  }
  
  // Summary
  const finalTimetable = await storage.getTimetable(userId);
  let totalEmpty = 0;
  for (const day of DAYS) {
    for (const schoolClass of CLASSES) {
      const maxPeriods = PERIODS_PER_DAY[day];
      for (let period = 1; period <= maxPeriods; period++) {
        const key = `${day}-${schoolClass}-${period}`;
        const slot = finalTimetable.get(key);
        if (!slot || slot.status !== "occupied") {
          totalEmpty++;
        }
      }
    }
  }
  
  return {
    slotsPlaced,
    warnings,
  };
}

// Check if teacher is free at a specific day/period (not teaching any class)
function isTeacherFreeAt(
  timetable: Map<string, TimetableSlot>,
  teacherId: string,
  day: Day,
  period: number
): boolean {
  for (const schoolClass of CLASSES) {
    const key = `${day}-${schoolClass}-${period}`;
    const slot = timetable.get(key);
    if (slot && (slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId)) {
      return false;
    }
  }
  return true;
}

async function scheduleSlashSubject(
  userId: string,
  schoolClass: SchoolClass,
  subject1: string,
  subject2: string,
  count: number,
  teachers: Teacher[],
  timetable: Map<string, TimetableSlot>,
  lockedSlots: Set<string>,
  warnings: string[],
  fatigueLimit: number = 5
): Promise<number> {
  let placed = 0;
  
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
    let slotPlaced = false;
    
    // Shuffle days and periods for variety between attempts
    const shuffledDays = shuffleArray([...DAYS]);
    
    for (const day of shuffledDays) {
      if (slotPlaced) break;
      const maxPeriods = PERIODS_PER_DAY[day];
      const shuffledPeriods = shuffleArray(Array.from({ length: maxPeriods }, (_, i) => i + 1));
      
      for (const period of shuffledPeriods) {
        if (slotPlaced) break;
        const key = `${day}-${schoolClass}-${period}`;
        
        if (lockedSlots.has(key)) continue;
        const slot = timetable.get(key);
        if (slot && slot.status === "occupied") continue;
        
        // Check if either subject already appears on this day for this class (max 1 occurrence per day)
        const dailyCount1 = getTotalSubjectCountForDay(timetable, day, schoolClass, subject1, []);
        const dailyCount2 = getTotalSubjectCountForDay(timetable, day, schoolClass, subject2, []);
        if (dailyCount1 >= 1 || dailyCount2 >= 1) continue;
        
        // Shuffle teacher ordering too
        const shuffledTeachers1 = shuffleArray([...teachers1]);
        for (const t1 of shuffledTeachers1) {
          if (slotPlaced) break;
          if (!isTeacherAvailableForSlot(timetable, t1, day, period)) continue;
          if (wouldExceedFatigue(timetable, t1.id, day, [period], fatigueLimit)) continue;
          
          const shuffledTeachers2 = shuffleArray([...teachers2]);
          for (const t2 of shuffledTeachers2) {
            if (t1.id === t2.id) continue;
            if (!isTeacherAvailableForSlot(timetable, t2, day, period)) continue;
            if (wouldExceedFatigue(timetable, t2.id, day, [period], fatigueLimit)) continue;
            
            if (subject1 === "Security" || subject2 === "Security") {
              const prevKey = `${day}-${schoolClass}-${period - 1}`;
              const prevSlot = timetable.get(prevKey);
              if (prevSlot && prevSlot.subject === "English") continue;
            }
            
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
            
            await storage.setSlot(userId, newSlot);
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
  userId: string,
  schoolClass: SchoolClass,
  subject: string,
  count: number,
  teachers: Teacher[],
  timetable: Map<string, TimetableSlot>,
  lockedSlots: Set<string>,
  warnings: string[],
  fatigueLimit: number = 5
): Promise<number> {
  let placed = 0;
  
  const availableTeachers = teachers.filter(t => 
    t.subjects.includes(subject) && 
    t.classes.includes(schoolClass) &&
    getTeacherSubjectClasses(t, subject).includes(schoolClass)
  );
  
  if (availableTeachers.length === 0) {
    warnings.push(`${schoolClass}: No teacher available for ${subject}`);
    return 0;
  }
  
  // Try to place double periods first if we need 2+ more periods
  // This helps create more efficient schedules
  while (placed < count) {
    const remaining = count - placed;
    let slotPlaced = false;
    
    // Shuffle for variety
    const shuffledDays = shuffleArray([...DAYS]);
    const shuffledTeachers = shuffleArray([...availableTeachers]);
    
    // Try double period first if we have 2+ remaining
    if (remaining >= 2) {
      for (const day of shuffledDays) {
        if (slotPlaced) break;
        const maxPeriods = PERIODS_PER_DAY[day];
        
        // Check if subject already appears on this day for this class (max 1 occurrence per day)
        const dailyCount = getTotalSubjectCountForDay(timetable, day, schoolClass, subject, []);
        if (dailyCount >= 1) continue;
        
        const shuffledPeriods = shuffleArray(Array.from({ length: maxPeriods - 1 }, (_, i) => i + 1));
        for (const period of shuffledPeriods) {
          if (slotPlaced) break;
          
          // Double period validation
          if (wouldCrossBreak(day, period)) continue; // Can't cross breaks
          
          const key1 = `${day}-${schoolClass}-${period}`;
          const key2 = `${day}-${schoolClass}-${period + 1}`;
          
          if (lockedSlots.has(key1) || lockedSlots.has(key2)) continue;
          
          const slot1 = timetable.get(key1);
          const slot2 = timetable.get(key2);
          if ((slot1 && slot1.status === "occupied") || (slot2 && slot2.status === "occupied")) continue;
          
          for (const teacher of shuffledTeachers) {
            // Check teacher available for both periods
            if (!isTeacherAvailableForSlot(timetable, teacher, day, period)) continue;
            if (!isTeacherAvailableForSlot(timetable, teacher, day, period + 1)) continue;
            if (wouldExceedFatigue(timetable, teacher.id, day, [period, period + 1], fatigueLimit)) continue;
            
            if (subject === "Security") {
              const prevKey = `${day}-${schoolClass}-${period - 1}`;
              const prevSlot = timetable.get(prevKey);
              if (prevSlot && prevSlot.subject === "English") continue;
            }
            
            // Place double period (first slot)
            const newSlot1: TimetableSlot = {
              day,
              period,
              schoolClass,
              status: "occupied",
              subject,
              teacherId: teacher.id,
              slotType: "double",
              slashPairSubject: null,
              slashPairTeacherId: null,
            };
            
            // Place double period (second slot)
            const newSlot2: TimetableSlot = {
              day,
              period: period + 1,
              schoolClass,
              status: "occupied",
              subject,
              teacherId: teacher.id,
              slotType: "double",
              slashPairSubject: null,
              slashPairTeacherId: null,
            };
            
            await storage.setSlot(userId, newSlot1);
            await storage.setSlot(userId, newSlot2);
            timetable.set(key1, newSlot1);
            timetable.set(key2, newSlot2);
            placed += 2;
            slotPlaced = true;
            break;
          }
        }
      }
    }
    
    // If double didn't work or only need 1 more, try single period
    if (!slotPlaced) {
      for (const day of shuffledDays) {
        if (slotPlaced) break;
        const maxPeriods = PERIODS_PER_DAY[day];
        
        // Check if subject already appears on this day for this class (max 1 occurrence per day)
        const dailyCount = getTotalSubjectCountForDay(timetable, day, schoolClass, subject, []);
        if (dailyCount >= 1) continue;
        
        const singlePeriods = shuffleArray(Array.from({ length: maxPeriods }, (_, i) => i + 1));
        for (const period of singlePeriods) {
          if (slotPlaced) break;
          const key = `${day}-${schoolClass}-${period}`;
          
          if (lockedSlots.has(key)) continue;
          const slot = timetable.get(key);
          if (slot && slot.status === "occupied") continue;
          
          for (const teacher of shuffledTeachers) {
            if (!isTeacherAvailableForSlot(timetable, teacher, day, period)) continue;
            if (wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit)) continue;
            
            if (subject === "Security") {
              const prevKey = `${day}-${schoolClass}-${period - 1}`;
              const prevSlot = timetable.get(prevKey);
              if (prevSlot && prevSlot.subject === "English") continue;
            }
            
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
            
            await storage.setSlot(userId, newSlot);
            timetable.set(key, newSlot);
            placed++;
            slotPlaced = true;
            break;
          }
        }
      }
    }
    
    // If we couldn't place anything, break to avoid infinite loop
    if (!slotPlaced) break;
  }
  
  return placed;
}

function isTeacherAvailableForSlot(
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

function wouldExceedFatigue(
  timetable: Map<string, TimetableSlot>,
  teacherId: string,
  day: Day,
  newPeriods: number[],
  fatigueLimit: number = 5
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
  
  return maxConsecutive > fatigueLimit;
}
