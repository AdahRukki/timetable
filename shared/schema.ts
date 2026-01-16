import { z } from "zod";

// ===== CONSTANTS =====
export const CLASSES = ["JSS1", "JSS2", "JSS3", "SS1", "SS2", "SS3"] as const;
export type SchoolClass = typeof CLASSES[number];

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export type Day = typeof DAYS[number];

// Period counts per day
export const PERIODS_PER_DAY: Record<Day, number> = {
  Monday: 9,
  Tuesday: 7,
  Wednesday: 9,
  Thursday: 9,
  Friday: 6,
};

// Break periods (after which period)
export const BREAK_AFTER_P4 = 4; // Break 1: after P4
export const BREAK_AFTER_P7 = 7; // Break 2: after P7 (Mon-Thu only)

// Friday special structure: P1-P3, Prayer 11:30-12:00, Break 12:00-12:30, P4-P6

// Subject period counts per week
export const JSS_SUBJECT_PERIODS: Record<string, number> = {
  "Maths": 5,
  "English": 4,
  "Basic Science": 3,
  "Basic Technology": 3,
  "Social Studies": 3,
  "Civic": 2,
  "Security": 2,
  "Home Economics": 2,
  "Agric": 3,
  "Computer": 2,
  "PHE": 3,
  "CRS": 3,
};

export const SS1_SUBJECT_PERIODS: Record<string, number> = {
  "Maths": 5,
  "English": 4,
  "Physics": 4,
  "Chemistry": 4,
  "Biology": 4,
  "Economics": 4,
  "Marketing": 3,
  "Government": 4,
  "Civic": 3,
  "CRS": 3,
  "Agric": 3,
  "Literature": 4,
};

// SS2 & SS3 slash subjects (paired subjects that must be scheduled simultaneously)
export const SLASH_SUBJECTS: Array<{
  pair: [string, string];
  periods: number;
}> = [
  { pair: ["Physics", "Literature"], periods: 4 },
  { pair: ["Chemistry", "Government"], periods: 4 },
  { pair: ["Agric", "CRS"], periods: 3 },
];

export const SS2_SS3_SUBJECT_PERIODS: Record<string, number> = {
  "Maths": 5,
  "English": 4,
  "Physics": 4,
  "Literature": 4,
  "Chemistry": 4,
  "Government": 4,
  "Biology": 4,
  "Economics": 4,
  "Marketing": 3,
  "Civic": 3,
  "Agric": 3,
  "CRS": 3,
};

// Get subjects for a class
export function getSubjectsForClass(schoolClass: SchoolClass): Record<string, number> {
  if (schoolClass.startsWith("JSS")) {
    return JSS_SUBJECT_PERIODS;
  } else if (schoolClass === "SS1") {
    return SS1_SUBJECT_PERIODS;
  } else {
    return SS2_SS3_SUBJECT_PERIODS;
  }
}

// Check if class uses slash subjects
export function usesSlashSubjects(schoolClass: SchoolClass): boolean {
  return schoolClass === "SS2" || schoolClass === "SS3";
}

// ===== TEACHER SCHEMA =====
export const teacherSchema = z.object({
  id: z.string(),
  name: z.string(),
  subjects: z.array(z.string()),
  classes: z.array(z.enum(CLASSES)),
  unavailable: z.record(z.enum(DAYS), z.array(z.number())), // day -> array of unavailable period numbers
  color: z.string(), // Hex color for visual identification
});

export type Teacher = z.infer<typeof teacherSchema>;

export const insertTeacherSchema = teacherSchema.omit({ id: true });
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;

// ===== TIMETABLE SLOT SCHEMA =====
export const slotTypeSchema = z.enum(["single", "double", "slash"]);
export type SlotType = z.infer<typeof slotTypeSchema>;

export const slotStatusSchema = z.enum(["empty", "occupied", "break"]);
export type SlotStatus = z.infer<typeof slotStatusSchema>;

export const timetableSlotSchema = z.object({
  day: z.enum(DAYS),
  period: z.number(),
  schoolClass: z.enum(CLASSES),
  status: slotStatusSchema,
  subject: z.string().nullable(),
  teacherId: z.string().nullable(),
  slotType: slotTypeSchema.nullable(),
  slashPairSubject: z.string().nullable(), // For slash subjects in SS2/SS3
  slashPairTeacherId: z.string().nullable(),
});

export type TimetableSlot = z.infer<typeof timetableSlotSchema>;

// ===== TIMETABLE ACTION (for undo/redo) =====
export const timetableActionSchema = z.object({
  id: z.string(),
  type: z.enum(["place", "remove"]),
  timestamp: z.number(),
  slot: timetableSlotSchema,
  previousSlot: timetableSlotSchema.nullable(),
});

export type TimetableAction = z.infer<typeof timetableActionSchema>;

// ===== VALIDATION RESULT =====
export const validationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});

export type ValidationError = z.infer<typeof validationErrorSchema>;

export const validationResultSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(validationErrorSchema),
});

export type ValidationResult = z.infer<typeof validationResultSchema>;

// ===== PLACEMENT REQUEST =====
export const placementRequestSchema = z.object({
  day: z.enum(DAYS),
  period: z.number(),
  schoolClass: z.enum(CLASSES),
  subject: z.string(),
  teacherId: z.string(),
  slotType: slotTypeSchema,
  slashPairSubject: z.string().optional(),
  slashPairTeacherId: z.string().optional(),
});

export type PlacementRequest = z.infer<typeof placementRequestSchema>;

// ===== TEACHER WORKLOAD =====
export const teacherWorkloadSchema = z.object({
  teacherId: z.string(),
  totalPeriods: z.number(),
  periodsByDay: z.record(z.enum(DAYS), z.number()),
  consecutivePeriodsWarnings: z.array(z.object({
    day: z.enum(DAYS),
    startPeriod: z.number(),
    endPeriod: z.number(),
    count: z.number(),
  })),
});

export type TeacherWorkload = z.infer<typeof teacherWorkloadSchema>;

// ===== SUBJECT PERIOD COUNT (for tracking weekly allocations) =====
export const subjectPeriodCountSchema = z.object({
  schoolClass: z.enum(CLASSES),
  subject: z.string(),
  allocated: z.number(),
  required: z.number(),
});

export type SubjectPeriodCount = z.infer<typeof subjectPeriodCountSchema>;

// ===== SUBJECT QUOTA CONFIGURATION =====
export const subjectQuotaSchema = z.object({
  subject: z.string(),
  jssQuota: z.number().min(0).max(10),
  ss1Quota: z.number().min(0).max(10),
  ss2ss3Quota: z.number().min(0).max(10),
  isSlashSubject: z.boolean().default(false),
});

export type SubjectQuota = z.infer<typeof subjectQuotaSchema>;

export const insertSubjectQuotaSchema = subjectQuotaSchema;
export type InsertSubjectQuota = z.infer<typeof insertSubjectQuotaSchema>;

// All possible subjects in the system
export const ALL_SUBJECTS = [
  "Maths", "English", "Basic Science", "Basic Technology", "Social Studies",
  "Civic", "Security", "Home Economics", "Agric", "Computer", "PHE", "CRS",
  "Physics", "Chemistry", "Biology", "Economics", "Marketing", "Government", "Literature",
] as const;

// Default quotas based on Nigerian curriculum
export const DEFAULT_QUOTAS: SubjectQuota[] = [
  { subject: "Maths", jssQuota: 5, ss1Quota: 5, ss2ss3Quota: 5, isSlashSubject: false },
  { subject: "English", jssQuota: 4, ss1Quota: 4, ss2ss3Quota: 4, isSlashSubject: false },
  { subject: "Basic Science", jssQuota: 3, ss1Quota: 0, ss2ss3Quota: 0, isSlashSubject: false },
  { subject: "Basic Technology", jssQuota: 3, ss1Quota: 0, ss2ss3Quota: 0, isSlashSubject: false },
  { subject: "Social Studies", jssQuota: 3, ss1Quota: 0, ss2ss3Quota: 0, isSlashSubject: false },
  { subject: "Civic", jssQuota: 2, ss1Quota: 3, ss2ss3Quota: 3, isSlashSubject: false },
  { subject: "Security", jssQuota: 2, ss1Quota: 0, ss2ss3Quota: 0, isSlashSubject: false },
  { subject: "Home Economics", jssQuota: 2, ss1Quota: 0, ss2ss3Quota: 0, isSlashSubject: false },
  { subject: "Agric", jssQuota: 3, ss1Quota: 3, ss2ss3Quota: 3, isSlashSubject: true },
  { subject: "Computer", jssQuota: 2, ss1Quota: 0, ss2ss3Quota: 0, isSlashSubject: false },
  { subject: "PHE", jssQuota: 3, ss1Quota: 0, ss2ss3Quota: 0, isSlashSubject: false },
  { subject: "CRS", jssQuota: 3, ss1Quota: 3, ss2ss3Quota: 3, isSlashSubject: true },
  { subject: "Physics", jssQuota: 0, ss1Quota: 4, ss2ss3Quota: 4, isSlashSubject: true },
  { subject: "Chemistry", jssQuota: 0, ss1Quota: 4, ss2ss3Quota: 4, isSlashSubject: true },
  { subject: "Biology", jssQuota: 0, ss1Quota: 4, ss2ss3Quota: 4, isSlashSubject: false },
  { subject: "Economics", jssQuota: 0, ss1Quota: 4, ss2ss3Quota: 4, isSlashSubject: false },
  { subject: "Marketing", jssQuota: 0, ss1Quota: 3, ss2ss3Quota: 3, isSlashSubject: false },
  { subject: "Government", jssQuota: 0, ss1Quota: 4, ss2ss3Quota: 4, isSlashSubject: true },
  { subject: "Literature", jssQuota: 0, ss1Quota: 4, ss2ss3Quota: 4, isSlashSubject: true },
];

// Get quota for a specific class
export function getQuotaForClass(quota: SubjectQuota, schoolClass: SchoolClass): number {
  if (schoolClass.startsWith("JSS")) {
    return quota.jssQuota;
  } else if (schoolClass === "SS1") {
    return quota.ss1Quota;
  } else {
    return quota.ss2ss3Quota;
  }
}

// ===== AUTO-GENERATION RESULT =====
export const autoGenerateResultSchema = z.object({
  success: z.boolean(),
  slotsPlaced: z.number(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});

export type AutoGenerateResult = z.infer<typeof autoGenerateResultSchema>;

// Legacy user schema (keeping for compatibility)
export const users = {
  $inferSelect: {} as { id: string; username: string; password: string },
};

export const insertUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
