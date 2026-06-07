import { z } from "zod";
import { pgTable, text, integer, jsonb, varchar, serial, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Export auth schema
export * from "./models/auth";

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

// Free period limits
export const MAX_FREE_PERIODS_PER_WEEK = 3; // Each class can have max 3 free periods per week
export const MAX_FREE_PERIODS_PER_DAY = 2; // Each class can have max 2 free periods per day
export const TOTAL_PERIODS_PER_WEEK = 40; // Total periods available per class per week
export const MIN_TEACHING_PERIODS_PER_WEEK = TOTAL_PERIODS_PER_WEEK - MAX_FREE_PERIODS_PER_WEEK; // 37 minimum teaching periods

// Friday special structure: P1-P3, Prayer 11:30-12:00, Break 12:00-12:30, P4-P6

// Find the partner Subject for a slash subject by name. Returns null when
// the named subject is not paired or its declared partner does not exist
// (or does not point back). Used by client and server to derive slash
// behavior from the user's own subjects table — no hardcoded pairs.
export function findSlashPair<S extends { name: string; isSlashSubject: boolean; slashPairName: string | null }>(
  subjects: S[],
  subjectName: string,
): S | null {
  const self = subjects.find((s) => s.name === subjectName);
  if (!self || !self.isSlashSubject || !self.slashPairName) return null;
  const partner = subjects.find((s) => s.name === self.slashPairName);
  if (!partner || !partner.isSlashSubject || partner.slashPairName !== self.name) return null;
  return partner;
}

// ===== DATABASE TABLES =====

// Teachers table
export const teachers = pgTable("teachers", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  subjects: text("subjects").array().notNull(),
  classes: text("classes").array().notNull(),
  subjectClasses: jsonb("subject_classes").$type<Record<string, string[]>>(),
  unavailable: jsonb("unavailable").notNull().$type<Record<string, number[]>>(),
  color: text("color").notNull(),
  // Per-teacher override for the global "max consecutive teaching periods"
  // rule. Null means "use the user's global fatigueLimit setting".
  maxConsecutivePeriods: integer("max_consecutive_periods"),
});

// Timetable slots table
export const timetableSlots = pgTable("timetable_slots", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  day: text("day").notNull(),
  period: integer("period").notNull(),
  schoolClass: text("school_class").notNull(),
  status: text("status").notNull(),
  subject: text("subject"),
  teacherId: varchar("teacher_id"),
  // slot_type: "single" | "double" | "slash" | "activity" (non-teaching).
  // An "activity" slot has subject = label (e.g. "Assembly"), teacherId = null.
  slotType: text("slot_type"),
  slashPairSubject: text("slash_pair_subject"),
  slashPairTeacherId: varchar("slash_pair_teacher_id"),
  // Fixed-period flag. When 1, the slot survives Clear & Generate and the
  // auto-generator's lockedSlots map always includes it regardless of the
  // user's "lock existing" toggle. Defaults to 0 for backwards compatibility.
  isLocked: integer("is_locked").notNull().default(0),
});

// Timetable actions table (for history)
export const timetableActions = pgTable("timetable_actions", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  timestamp: integer("timestamp").notNull(),
  slotData: jsonb("slot_data").notNull(),
  previousSlotData: jsonb("previous_slot_data"),
});

// Per-class-level scheduling preference shapes (mirrored on subjects + subject_quotas)
export type PreferredPeriods = { jss: number[]; ss1: number[]; ss2ss3: number[] };
export type RequiredDoubles = { jss: number; ss1: number; ss2ss3: number };

const DEFAULT_PREFERRED_PERIODS: PreferredPeriods = { jss: [], ss1: [], ss2ss3: [] };
const DEFAULT_REQUIRED_DOUBLES: RequiredDoubles = { jss: 0, ss1: 0, ss2ss3: 0 };

// Subject quotas table
export const subjectQuotas = pgTable("subject_quotas", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  subject: text("subject").notNull(),
  jssQuota: integer("jss_quota").notNull(),
  ss1Quota: integer("ss1_quota").notNull(),
  ss2ss3Quota: integer("ss2ss3_quota").notNull(),
  isSlashSubject: integer("is_slash_subject").notNull().default(0),
  singleOnly: integer("single_only").notNull().default(0),
  preferredPeriods: jsonb("preferred_periods")
    .$type<PreferredPeriods>()
    .notNull()
    .default(DEFAULT_PREFERRED_PERIODS),
  requiredDoubles: jsonb("required_doubles")
    .$type<RequiredDoubles>()
    .notNull()
    .default(DEFAULT_REQUIRED_DOUBLES),
});

// Custom subjects table
export const subjects = pgTable("subjects", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  jssQuota: integer("jss_quota").notNull().default(0),
  ss1Quota: integer("ss1_quota").notNull().default(0),
  ss2ss3Quota: integer("ss2ss3_quota").notNull().default(0),
  isSlashSubject: integer("is_slash_subject").notNull().default(0),
  slashPairName: text("slash_pair_name"),
  singleOnly: integer("single_only").notNull().default(0),
  preferredPeriods: jsonb("preferred_periods")
    .$type<PreferredPeriods>()
    .notNull()
    .default(DEFAULT_PREFERRED_PERIODS),
  requiredDoubles: jsonb("required_doubles")
    .$type<RequiredDoubles>()
    .notNull()
    .default(DEFAULT_REQUIRED_DOUBLES),
});

// User settings table
export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  fatigueLimit: integer("fatigue_limit").notNull().default(5),
  maxFreePeriodsPerWeek: integer("max_free_periods_per_week").notNull().default(3),
  maxFreePeriodsPerDay: integer("max_free_periods_per_day").notNull().default(2),
  // Per-class weekly free-period overrides. Keys are SchoolClass names
  // ("JSS1", "SS2", etc.). Missing keys fall back to maxFreePeriodsPerWeek.
  freePeriodsPerClass: jsonb("free_periods_per_class")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  allowDoublePeriods: integer("allow_double_periods").notNull().default(1),
  allowDoubleInP8P9: integer("allow_double_in_p8p9").notNull().default(1),
});

// Shared timetables table
export const sharedTimetables = pgTable("shared_timetables", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }),
  timetableData: jsonb("timetable_data").notNull(),
  teacherData: jsonb("teacher_data").notNull(),
  title: text("title"),
});

// Shape used by the savedTimetables.timetableData jsonb column. Mirrors
// timetableSlotSchema below but is declared inline so it can be referenced
// at table-definition time (before the zod schemas are introduced).
type SavedSlotShape = {
  day: typeof DAYS[number];
  period: number;
  schoolClass: typeof CLASSES[number];
  status: "empty" | "occupied" | "break";
  subject: string | null;
  teacherId: string | null;
  slotType: "single" | "double" | "slash" | "activity" | null;
  slashPairSubject: string | null;
  slashPairTeacherId: string | null;
  isLocked?: boolean;
};

// Saved timetables table (named snapshots that can be reloaded into the live grid)
export const savedTimetables = pgTable("saved_timetables", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  timetableData: jsonb("timetable_data").$type<SavedSlotShape[]>().notNull(),
});

// ===== ZOD SCHEMAS =====

// Teacher schema
export const teacherSchema = z.object({
  id: z.string(),
  name: z.string(),
  subjects: z.array(z.string()),
  classes: z.array(z.enum(CLASSES)),
  subjectClasses: z.record(z.string(), z.array(z.enum(CLASSES))).optional(),
  unavailable: z.record(z.enum(DAYS), z.array(z.number())),
  color: z.string(),
  // Per-teacher cap on consecutive teaching periods. `null` (or omitted)
  // means "use the user's global fatigueLimit setting".
  maxConsecutivePeriods: z.number().int().min(1).max(10).nullable().optional(),
});

export type Teacher = z.infer<typeof teacherSchema>;

// Helper to get classes a teacher can teach a specific subject to
export function getTeacherSubjectClasses(teacher: Teacher, subject: string): SchoolClass[] {
  if (teacher.subjectClasses && teacher.subjectClasses[subject]) {
    return teacher.subjectClasses[subject];
  }
  return teacher.classes;
}

export const insertTeacherSchema = teacherSchema.omit({ id: true });
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;

// Slot types
// "activity" = non-teaching fixed period (Assembly, Library, Sports, ...).
// Activity slots have a label in `subject`, no teacherId, no slash pair, and
// are always treated as locked by the auto-generator.
export const slotTypeSchema = z.enum(["single", "double", "slash", "activity"]);
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
  slashPairSubject: z.string().nullable(),
  slashPairTeacherId: z.string().nullable(),
  // Fixed-period flag. When true the slot is preserved across Clear & Generate
  // and the auto-generator never overwrites it. Defaults to false for older
  // payloads (saved timetables, shared timetables) that predate this column.
  isLocked: z.boolean().default(false),
});

export type TimetableSlot = z.infer<typeof timetableSlotSchema>;

// Timetable action (for undo/redo)
export const timetableActionSchema = z.object({
  id: z.string(),
  type: z.enum(["place", "remove"]),
  timestamp: z.number(),
  slot: timetableSlotSchema,
  previousSlot: timetableSlotSchema.nullable(),
});

export type TimetableAction = z.infer<typeof timetableActionSchema>;

// Validation result
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

// Placement request
// `isActivity` flips the placement into a non-teaching fixed period: subject
// becomes a free-text label and teacherId is not required. `isLocked` (default
// true for activities, false otherwise on the server) marks the slot as a
// fixed period that survives Clear & Generate. `applyToAllClasses` mirrors the
// placement to every class in CLASSES inside a single transaction; partial
// failures roll the whole batch back.
export const placementRequestSchema = z
  .object({
    day: z.enum(DAYS),
    period: z.number(),
    schoolClass: z.enum(CLASSES),
    subject: z.string().min(1, "Subject or activity label is required"),
    teacherId: z.string().optional(),
    slotType: slotTypeSchema,
    slashPairSubject: z.string().optional(),
    slashPairTeacherId: z.string().optional(),
    isActivity: z.boolean().optional(),
    isLocked: z.boolean().optional(),
    applyToAllClasses: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const isActivity = data.isActivity || data.slotType === "activity";
    if (isActivity) {
      if (data.slotType !== "activity") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slotType"],
          message: "Activity placements must use slotType=\"activity\"",
        });
      }
      if (data.slashPairSubject || data.slashPairTeacherId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slashPairSubject"],
          message: "Activities cannot be slash-paired",
        });
      }
    } else {
      if (!data.teacherId || data.teacherId.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["teacherId"],
          message: "Teacher is required",
        });
      }
    }
  });

export type PlacementRequest = z.infer<typeof placementRequestSchema>;

// Teacher workload
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

// Subject period count
export const subjectPeriodCountSchema = z.object({
  schoolClass: z.enum(CLASSES),
  subject: z.string(),
  allocated: z.number(),
  required: z.number(),
});

export type SubjectPeriodCount = z.infer<typeof subjectPeriodCountSchema>;

// Per-class-level scheduling preference Zod schemas (shared by subjects + subject quotas)
export const preferredPeriodsSchema = z.object({
  jss: z.array(z.number().int().min(1).max(9)).default([]),
  ss1: z.array(z.number().int().min(1).max(9)).default([]),
  ss2ss3: z.array(z.number().int().min(1).max(9)).default([]),
});

export const requiredDoublesSchema = z.object({
  jss: z.number().int().min(0).max(4).default(0),
  ss1: z.number().int().min(0).max(4).default(0),
  ss2ss3: z.number().int().min(0).max(4).default(0),
});

// Subject quota configuration
export const subjectQuotaSchema = z.object({
  subject: z.string(),
  jssQuota: z.number().min(0).max(10),
  ss1Quota: z.number().min(0).max(10),
  ss2ss3Quota: z.number().min(0).max(10),
  isSlashSubject: z.boolean().default(false),
  singleOnly: z.boolean().default(false),
  preferredPeriods: preferredPeriodsSchema.default({ jss: [], ss1: [], ss2ss3: [] }),
  requiredDoubles: requiredDoublesSchema.default({ jss: 0, ss1: 0, ss2ss3: 0 }),
});

export type SubjectQuota = z.infer<typeof subjectQuotaSchema>;

export const insertSubjectQuotaSchema = subjectQuotaSchema;
export type InsertSubjectQuota = z.infer<typeof insertSubjectQuotaSchema>;

// Subject schema (for custom subjects)
export const subjectSchema = z.object({
  id: z.number(),
  name: z.string().min(1, "Subject name is required"),
  jssQuota: z.number().min(0).max(10).default(0),
  ss1Quota: z.number().min(0).max(10).default(0),
  ss2ss3Quota: z.number().min(0).max(10).default(0),
  isSlashSubject: z.boolean().default(false),
  slashPairName: z.string().nullable().default(null),
  singleOnly: z.boolean().default(false),
  preferredPeriods: preferredPeriodsSchema.default({ jss: [], ss1: [], ss2ss3: [] }),
  requiredDoubles: requiredDoublesSchema.default({ jss: 0, ss1: 0, ss2ss3: 0 }),
});

export type Subject = z.infer<typeof subjectSchema>;

export const insertSubjectSchema = subjectSchema.omit({ id: true });
export type InsertSubject = z.infer<typeof insertSubjectSchema>;

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

// Auto-generation result
export const autoGenerateResultSchema = z.object({
  success: z.boolean(),
  slotsPlaced: z.number(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});

export type AutoGenerateResult = z.infer<typeof autoGenerateResultSchema>;

// User settings schema
export const userSettingsSchema = z.object({
  fatigueLimit: z.number().min(1).max(10).default(5),
  maxFreePeriodsPerWeek: z.number().min(0).max(10).default(3),
  maxFreePeriodsPerDay: z.number().min(0).max(5).default(2),
  freePeriodsPerClass: z
    .record(z.enum(CLASSES), z.number().min(0).max(40))
    .default({}),
  allowDoublePeriods: z.boolean().default(true),
  allowDoubleInP8P9: z.boolean().default(true),
});

export type UserSettings = z.infer<typeof userSettingsSchema>;

export const insertUserSettingsSchema = userSettingsSchema;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;

// Shared timetable schema
export const sharedTimetableSchema = z.object({
  id: z.string(),
  userId: z.string(),
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
  timetableData: z.array(timetableSlotSchema),
  teacherData: z.array(teacherSchema),
  title: z.string().nullable(),
});

export type SharedTimetable = z.infer<typeof sharedTimetableSchema>;

// Saved timetable schema
export const savedTimetableSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1, "Name is required"),
  createdAt: z.number(),
  timetableData: z.array(timetableSlotSchema),
});

export type SavedTimetable = z.infer<typeof savedTimetableSchema>;

export const insertSavedTimetableSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});
export type InsertSavedTimetable = z.infer<typeof insertSavedTimetableSchema>;
