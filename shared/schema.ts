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
  slotType: text("slot_type"),
  slashPairSubject: text("slash_pair_subject"),
  slashPairTeacherId: varchar("slash_pair_teacher_id"),
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

// Subject quotas table
export const subjectQuotas = pgTable("subject_quotas", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  subject: text("subject").notNull(),
  jssQuota: integer("jss_quota").notNull(),
  ss1Quota: integer("ss1_quota").notNull(),
  ss2ss3Quota: integer("ss2ss3_quota").notNull(),
  isSlashSubject: integer("is_slash_subject").notNull().default(0),
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
});

// User settings table
export const userSettings = pgTable("user_settings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  fatigueLimit: integer("fatigue_limit").notNull().default(5),
  maxFreePeriodsPerWeek: integer("max_free_periods_per_week").notNull().default(3),
  maxFreePeriodsPerDay: integer("max_free_periods_per_day").notNull().default(2),
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
  slotType: "single" | "double" | "slash" | null;
  slashPairSubject: string | null;
  slashPairTeacherId: string | null;
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
  slashPairSubject: z.string().nullable(),
  slashPairTeacherId: z.string().nullable(),
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

// Subject quota configuration
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

// Subject schema (for custom subjects)
export const subjectSchema = z.object({
  id: z.number(),
  name: z.string().min(1, "Subject name is required"),
  jssQuota: z.number().min(0).max(10).default(0),
  ss1Quota: z.number().min(0).max(10).default(0),
  ss2ss3Quota: z.number().min(0).max(10).default(0),
  isSlashSubject: z.boolean().default(false),
  slashPairName: z.string().nullable().default(null),
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
