import {
  type Teacher,
  type InsertTeacher,
  type TimetableSlot,
  type TimetableAction,
  type Day,
  type SchoolClass,
  type SubjectQuota,
  type Subject,
  type InsertSubject,
  type UserSettings,
  type SharedTimetable,
  type SavedTimetable,
  DAYS,
  CLASSES,
  PERIODS_PER_DAY,
  teachers,
  timetableSlots,
  timetableActions,
  subjectQuotas,
  subjects,
  userSettings,
  sharedTimetables,
  savedTimetables,
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

function getSlotKey(day: Day, schoolClass: SchoolClass, period: number): string {
  return `${day}-${schoolClass}-${period}`;
}

export interface IStorage {
  // Teachers
  getTeachers(userId: string): Promise<Teacher[]>;
  getTeacher(userId: string, id: string): Promise<Teacher | undefined>;
  createTeacher(userId: string, teacher: InsertTeacher): Promise<Teacher>;
  updateTeacher(userId: string, id: string, teacher: Partial<InsertTeacher>): Promise<Teacher | undefined>;
  deleteTeacher(userId: string, id: string): Promise<boolean>;

  // Timetable
  getTimetable(userId: string): Promise<Map<string, TimetableSlot>>;
  getSlot(userId: string, day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined>;
  setSlot(userId: string, slot: TimetableSlot): Promise<TimetableSlot>;
  clearSlot(userId: string, day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined>;
  clearAllSlots(userId: string): Promise<void>;

  // Actions (for undo/redo)
  getActions(userId: string): Promise<TimetableAction[]>;
  addAction(userId: string, action: Omit<TimetableAction, "id">): Promise<TimetableAction>;
  clearActions(userId: string): Promise<void>;

  // Subject Quotas
  getSubjectQuotas(userId: string): Promise<SubjectQuota[]>;
  updateSubjectQuota(userId: string, subject: string, quota: Partial<SubjectQuota>): Promise<SubjectQuota | undefined>;

  // Subjects
  getSubjects(userId: string): Promise<Subject[]>;
  getSubject(userId: string, id: number): Promise<Subject | undefined>;
  createSubject(userId: string, subject: InsertSubject): Promise<Subject>;
  updateSubject(userId: string, id: number, subject: Partial<InsertSubject>): Promise<Subject | undefined>;
  deleteSubject(userId: string, id: number): Promise<boolean>;
  
  // User settings
  getUserSettings(userId: string): Promise<UserSettings>;
  updateUserSettings(userId: string, settings: Partial<UserSettings>): Promise<UserSettings>;
  
  // Shared timetables
  createSharedTimetable(userId: string, timetableData: TimetableSlot[], teacherData: Teacher[], title?: string): Promise<SharedTimetable>;
  getSharedTimetable(shareId: string): Promise<SharedTimetable | undefined>;
  deleteSharedTimetable(userId: string, shareId: string): Promise<boolean>;
  getUserSharedTimetables(userId: string): Promise<SharedTimetable[]>;

  // Saved timetables
  listSavedTimetables(userId: string): Promise<SavedTimetable[]>;
  getSavedTimetable(userId: string, id: string): Promise<SavedTimetable | undefined>;
  createSavedTimetable(userId: string, name: string, slots: TimetableSlot[]): Promise<SavedTimetable>;
  renameSavedTimetable(userId: string, id: string, name: string): Promise<SavedTimetable | undefined>;
  deleteSavedTimetable(userId: string, id: string): Promise<boolean>;
  loadSavedTimetable(userId: string, id: string): Promise<boolean>;

  // Initialize user data
  initializeUserData(userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Ensure baseline per-user records exist. New users start with empty subjects,
  // quotas, and teachers; only default user settings are created.
  async initializeUserData(userId: string): Promise<void> {
    await db.insert(userSettings).values({ userId, fatigueLimit: 5 }).onConflictDoNothing();
  }

  // Teachers
  async getTeachers(userId: string): Promise<Teacher[]> {
    const rows = await db.select().from(teachers).where(eq(teachers.userId, userId));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      subjects: row.subjects,
      classes: row.classes as SchoolClass[],
      subjectClasses: row.subjectClasses as Record<string, SchoolClass[]> | undefined,
      unavailable: row.unavailable as Record<Day, number[]>,
      color: row.color,
    }));
  }

  async getTeacher(userId: string, id: string): Promise<Teacher | undefined> {
    const [row] = await db.select().from(teachers).where(and(eq(teachers.userId, userId), eq(teachers.id, id)));
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      subjects: row.subjects,
      classes: row.classes as SchoolClass[],
      subjectClasses: row.subjectClasses as Record<string, SchoolClass[]> | undefined,
      unavailable: row.unavailable as Record<Day, number[]>,
      color: row.color,
    };
  }

  async createTeacher(userId: string, insertTeacher: InsertTeacher): Promise<Teacher> {
    const id = randomUUID();
    await db.insert(teachers).values({
      id,
      userId,
      name: insertTeacher.name,
      subjects: insertTeacher.subjects,
      classes: insertTeacher.classes,
      subjectClasses: insertTeacher.subjectClasses,
      unavailable: insertTeacher.unavailable,
      color: insertTeacher.color,
    });
    return { ...insertTeacher, id };
  }

  async updateTeacher(userId: string, id: string, updates: Partial<InsertTeacher>): Promise<Teacher | undefined> {
    const existing = await this.getTeacher(userId, id);
    if (!existing) return undefined;

    const updateValues: any = {};
    if (updates.name !== undefined) updateValues.name = updates.name;
    if (updates.subjects !== undefined) updateValues.subjects = updates.subjects;
    if (updates.classes !== undefined) updateValues.classes = updates.classes;
    if (updates.subjectClasses !== undefined) updateValues.subjectClasses = updates.subjectClasses;
    if (updates.unavailable !== undefined) updateValues.unavailable = updates.unavailable;
    if (updates.color !== undefined) updateValues.color = updates.color;

    await db.update(teachers).set(updateValues).where(and(eq(teachers.userId, userId), eq(teachers.id, id)));
    return { ...existing, ...updates };
  }

  async deleteTeacher(userId: string, id: string): Promise<boolean> {
    const result = await db.delete(teachers).where(and(eq(teachers.userId, userId), eq(teachers.id, id)));
    return true;
  }

  // Timetable
  async getTimetable(userId: string): Promise<Map<string, TimetableSlot>> {
    const timetable = new Map<string, TimetableSlot>();
    
    // Initialize empty slots
    for (const day of DAYS) {
      const maxPeriods = PERIODS_PER_DAY[day];
      for (const schoolClass of CLASSES) {
        for (let period = 1; period <= maxPeriods; period++) {
          const key = getSlotKey(day, schoolClass, period);
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

    // Load saved slots
    const rows = await db.select().from(timetableSlots).where(eq(timetableSlots.userId, userId));
    for (const row of rows) {
      const key = getSlotKey(row.day as Day, row.schoolClass as SchoolClass, row.period);
      timetable.set(key, {
        day: row.day as Day,
        period: row.period,
        schoolClass: row.schoolClass as SchoolClass,
        status: row.status as "empty" | "occupied" | "break",
        subject: row.subject,
        teacherId: row.teacherId,
        slotType: row.slotType as "single" | "double" | "slash" | null,
        slashPairSubject: row.slashPairSubject,
        slashPairTeacherId: row.slashPairTeacherId,
      });
    }

    return timetable;
  }

  async getSlot(userId: string, day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined> {
    const [row] = await db.select().from(timetableSlots).where(
      and(
        eq(timetableSlots.userId, userId),
        eq(timetableSlots.day, day),
        eq(timetableSlots.schoolClass, schoolClass),
        eq(timetableSlots.period, period)
      )
    );
    
    if (!row) {
      return {
        day,
        period,
        schoolClass,
        status: "empty",
        subject: null,
        teacherId: null,
        slotType: null,
        slashPairSubject: null,
        slashPairTeacherId: null,
      };
    }

    return {
      day: row.day as Day,
      period: row.period,
      schoolClass: row.schoolClass as SchoolClass,
      status: row.status as "empty" | "occupied" | "break",
      subject: row.subject,
      teacherId: row.teacherId,
      slotType: row.slotType as "single" | "double" | "slash" | null,
      slashPairSubject: row.slashPairSubject,
      slashPairTeacherId: row.slashPairTeacherId,
    };
  }

  async setSlot(userId: string, slot: TimetableSlot): Promise<TimetableSlot> {
    // Delete existing slot first
    await db.delete(timetableSlots).where(
      and(
        eq(timetableSlots.userId, userId),
        eq(timetableSlots.day, slot.day),
        eq(timetableSlots.schoolClass, slot.schoolClass),
        eq(timetableSlots.period, slot.period)
      )
    );

    // Insert new slot if not empty
    if (slot.status !== "empty") {
      await db.insert(timetableSlots).values({
        userId,
        day: slot.day,
        period: slot.period,
        schoolClass: slot.schoolClass,
        status: slot.status,
        subject: slot.subject,
        teacherId: slot.teacherId,
        slotType: slot.slotType,
        slashPairSubject: slot.slashPairSubject,
        slashPairTeacherId: slot.slashPairTeacherId,
      });
    }

    return slot;
  }

  async clearSlot(userId: string, day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined> {
    await db.delete(timetableSlots).where(
      and(
        eq(timetableSlots.userId, userId),
        eq(timetableSlots.day, day),
        eq(timetableSlots.schoolClass, schoolClass),
        eq(timetableSlots.period, period)
      )
    );

    return {
      day,
      period,
      schoolClass,
      status: "empty",
      subject: null,
      teacherId: null,
      slotType: null,
      slashPairSubject: null,
      slashPairTeacherId: null,
    };
  }

  async clearAllSlots(userId: string): Promise<void> {
    await db.delete(timetableSlots).where(eq(timetableSlots.userId, userId));
  }

  // Actions
  async getActions(userId: string): Promise<TimetableAction[]> {
    const rows = await db.select().from(timetableActions).where(eq(timetableActions.userId, userId));
    return rows.map((row) => ({
      id: row.id,
      type: row.type as "place" | "remove",
      timestamp: row.timestamp,
      slot: row.slotData as TimetableSlot,
      previousSlot: row.previousSlotData as TimetableSlot | null,
    }));
  }

  async addAction(userId: string, action: Omit<TimetableAction, "id">): Promise<TimetableAction> {
    const id = randomUUID();
    await db.insert(timetableActions).values({
      id,
      userId,
      type: action.type,
      timestamp: action.timestamp,
      slotData: action.slot,
      previousSlotData: action.previousSlot,
    });
    return { ...action, id };
  }

  async clearActions(userId: string): Promise<void> {
    await db.delete(timetableActions).where(eq(timetableActions.userId, userId));
  }

  // Subject Quotas
  async getSubjectQuotas(userId: string): Promise<SubjectQuota[]> {
    const rows = await db.select().from(subjectQuotas).where(eq(subjectQuotas.userId, userId));
    return rows.map((row) => ({
      subject: row.subject,
      jssQuota: row.jssQuota,
      ss1Quota: row.ss1Quota,
      ss2ss3Quota: row.ss2ss3Quota,
      isSlashSubject: row.isSlashSubject === 1,
    }));
  }

  async updateSubjectQuota(userId: string, subject: string, updates: Partial<SubjectQuota>): Promise<SubjectQuota | undefined> {
    const [existing] = await db.select().from(subjectQuotas).where(
      and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, subject))
    );
    if (!existing) return undefined;

    const updateValues: any = {};
    if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
    if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;
    if (updates.ss2ss3Quota !== undefined) updateValues.ss2ss3Quota = updates.ss2ss3Quota;
    if (updates.isSlashSubject !== undefined) updateValues.isSlashSubject = updates.isSlashSubject ? 1 : 0;

    await db.update(subjectQuotas).set(updateValues).where(
      and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, subject))
    );

    return {
      subject: existing.subject,
      jssQuota: updates.jssQuota ?? existing.jssQuota,
      ss1Quota: updates.ss1Quota ?? existing.ss1Quota,
      ss2ss3Quota: updates.ss2ss3Quota ?? existing.ss2ss3Quota,
      isSlashSubject: updates.isSlashSubject ?? (existing.isSlashSubject === 1),
    };
  }

  // Subjects
  async getSubjects(userId: string): Promise<Subject[]> {
    const rows = await db.select().from(subjects).where(eq(subjects.userId, userId));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      jssQuota: row.jssQuota,
      ss1Quota: row.ss1Quota,
      ss2ss3Quota: row.ss2ss3Quota,
      isSlashSubject: row.isSlashSubject === 1,
      slashPairName: row.slashPairName,
    }));
  }

  async getSubject(userId: string, id: number): Promise<Subject | undefined> {
    const [row] = await db.select().from(subjects).where(
      and(eq(subjects.userId, userId), eq(subjects.id, id))
    );
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      jssQuota: row.jssQuota,
      ss1Quota: row.ss1Quota,
      ss2ss3Quota: row.ss2ss3Quota,
      isSlashSubject: row.isSlashSubject === 1,
      slashPairName: row.slashPairName,
    };
  }

  async createSubject(userId: string, subject: InsertSubject): Promise<Subject> {
    const [inserted] = await db.insert(subjects).values({
      userId,
      name: subject.name,
      jssQuota: subject.jssQuota,
      ss1Quota: subject.ss1Quota,
      ss2ss3Quota: subject.ss2ss3Quota,
      isSlashSubject: subject.isSlashSubject ? 1 : 0,
      slashPairName: subject.slashPairName,
    }).returning({ id: subjects.id });

    // Also add to subject_quotas table for consistency
    await db.insert(subjectQuotas).values({
      userId,
      subject: subject.name,
      jssQuota: subject.jssQuota,
      ss1Quota: subject.ss1Quota,
      ss2ss3Quota: subject.ss2ss3Quota,
      isSlashSubject: subject.isSlashSubject ? 1 : 0,
    }).onConflictDoNothing();

    return {
      id: inserted.id,
      name: subject.name,
      jssQuota: subject.jssQuota,
      ss1Quota: subject.ss1Quota,
      ss2ss3Quota: subject.ss2ss3Quota,
      isSlashSubject: subject.isSlashSubject,
      slashPairName: subject.slashPairName,
    };
  }

  async updateSubject(userId: string, id: number, updates: Partial<InsertSubject>): Promise<Subject | undefined> {
    const existing = await this.getSubject(userId, id);
    if (!existing) return undefined;

    const updateValues: any = {};
    if (updates.name !== undefined) updateValues.name = updates.name;
    if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
    if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;
    if (updates.ss2ss3Quota !== undefined) updateValues.ss2ss3Quota = updates.ss2ss3Quota;
    if (updates.isSlashSubject !== undefined) updateValues.isSlashSubject = updates.isSlashSubject ? 1 : 0;
    if (updates.slashPairName !== undefined) updateValues.slashPairName = updates.slashPairName;

    await db.update(subjects).set(updateValues).where(
      and(eq(subjects.userId, userId), eq(subjects.id, id))
    );

    // Also update subject_quotas table
    const quotaUpdates: any = {};
    if (updates.jssQuota !== undefined) quotaUpdates.jssQuota = updates.jssQuota;
    if (updates.ss1Quota !== undefined) quotaUpdates.ss1Quota = updates.ss1Quota;
    if (updates.ss2ss3Quota !== undefined) quotaUpdates.ss2ss3Quota = updates.ss2ss3Quota;
    if (updates.isSlashSubject !== undefined) quotaUpdates.isSlashSubject = updates.isSlashSubject ? 1 : 0;

    if (Object.keys(quotaUpdates).length > 0) {
      await db.update(subjectQuotas).set(quotaUpdates).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
      );
    }

    // If name changed, update subject_quotas subject name
    if (updates.name && updates.name !== existing.name) {
      await db.update(subjectQuotas).set({ subject: updates.name }).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
      );
    }

    return { ...existing, ...updates };
  }

  async deleteSubject(userId: string, id: number): Promise<boolean> {
    const existing = await this.getSubject(userId, id);
    if (!existing) return false;

    await db.delete(subjects).where(
      and(eq(subjects.userId, userId), eq(subjects.id, id))
    );

    // Also delete from subject_quotas
    await db.delete(subjectQuotas).where(
      and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
    );

    return true;
  }

  async getUserSettings(userId: string): Promise<UserSettings> {
    const results = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    if (results.length > 0) {
      const row = results[0];
      return {
        fatigueLimit: row.fatigueLimit,
        maxFreePeriodsPerWeek: row.maxFreePeriodsPerWeek,
        maxFreePeriodsPerDay: row.maxFreePeriodsPerDay,
        allowDoublePeriods: row.allowDoublePeriods === 1,
        allowDoubleInP8P9: row.allowDoubleInP8P9 === 1,
      };
    }
    // Create default settings if none exist
    await db.insert(userSettings).values({
      userId,
      fatigueLimit: 5,
      maxFreePeriodsPerWeek: 3,
      maxFreePeriodsPerDay: 2,
      allowDoublePeriods: 1,
      allowDoubleInP8P9: 1,
    });
    return {
      fatigueLimit: 5,
      maxFreePeriodsPerWeek: 3,
      maxFreePeriodsPerDay: 2,
      allowDoublePeriods: true,
      allowDoubleInP8P9: true,
    };
  }

  async updateUserSettings(userId: string, settings: Partial<UserSettings>): Promise<UserSettings> {
    // Ensure settings exist first
    const existing = await this.getUserSettings(userId);
    
    const newSettings = { ...existing, ...settings };
    await db.update(userSettings).set({
      fatigueLimit: newSettings.fatigueLimit,
      maxFreePeriodsPerWeek: newSettings.maxFreePeriodsPerWeek,
      maxFreePeriodsPerDay: newSettings.maxFreePeriodsPerDay,
      allowDoublePeriods: newSettings.allowDoublePeriods ? 1 : 0,
      allowDoubleInP8P9: newSettings.allowDoubleInP8P9 ? 1 : 0,
    }).where(eq(userSettings.userId, userId));
    return newSettings;
  }

  async createSharedTimetable(userId: string, timetableData: TimetableSlot[], teacherData: Teacher[], title?: string): Promise<SharedTimetable> {
    const id = randomUUID().substring(0, 8);
    const createdAt = Date.now();
    
    await db.insert(sharedTimetables).values({
      id,
      userId,
      createdAt,
      expiresAt: null,
      timetableData: timetableData as any,
      teacherData: teacherData as any,
      title: title || null,
    });

    return {
      id,
      userId,
      createdAt,
      expiresAt: null,
      timetableData,
      teacherData,
      title: title || null,
    };
  }

  async getSharedTimetable(shareId: string): Promise<SharedTimetable | undefined> {
    const results = await db.select().from(sharedTimetables).where(eq(sharedTimetables.id, shareId));
    if (results.length === 0) return undefined;

    const row = results[0];
    return {
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      timetableData: row.timetableData as TimetableSlot[],
      teacherData: row.teacherData as Teacher[],
      title: row.title,
    };
  }

  async deleteSharedTimetable(userId: string, shareId: string): Promise<boolean> {
    const result = await db.delete(sharedTimetables).where(
      and(eq(sharedTimetables.id, shareId), eq(sharedTimetables.userId, userId))
    );
    return true;
  }

  async getUserSharedTimetables(userId: string): Promise<SharedTimetable[]> {
    const results = await db.select().from(sharedTimetables).where(eq(sharedTimetables.userId, userId));
    return results.map(row => ({
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      timetableData: row.timetableData as TimetableSlot[],
      teacherData: row.teacherData as Teacher[],
      title: row.title,
    }));
  }

  // ===== Saved timetables =====
  async listSavedTimetables(userId: string): Promise<SavedTimetable[]> {
    const rows = await db.select().from(savedTimetables).where(eq(savedTimetables.userId, userId));
    return rows
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.name,
        createdAt: row.createdAt,
        timetableData: row.timetableData as TimetableSlot[],
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getSavedTimetable(userId: string, id: string): Promise<SavedTimetable | undefined> {
    const rows = await db.select().from(savedTimetables).where(
      and(eq(savedTimetables.id, id), eq(savedTimetables.userId, userId))
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      createdAt: row.createdAt,
      timetableData: row.timetableData as TimetableSlot[],
    };
  }

  async createSavedTimetable(userId: string, name: string, slots: TimetableSlot[]): Promise<SavedTimetable> {
    const id = randomUUID();
    const createdAt = Date.now();
    await db.insert(savedTimetables).values({
      id,
      userId,
      name,
      createdAt,
      timetableData: slots,
    });
    return { id, userId, name, createdAt, timetableData: slots };
  }

  async renameSavedTimetable(userId: string, id: string, name: string): Promise<SavedTimetable | undefined> {
    await db.update(savedTimetables)
      .set({ name })
      .where(and(eq(savedTimetables.id, id), eq(savedTimetables.userId, userId)));
    return this.getSavedTimetable(userId, id);
  }

  async deleteSavedTimetable(userId: string, id: string): Promise<boolean> {
    await db.delete(savedTimetables).where(
      and(eq(savedTimetables.id, id), eq(savedTimetables.userId, userId))
    );
    return true;
  }

  async loadSavedTimetable(userId: string, id: string): Promise<boolean> {
    const saved = await this.getSavedTimetable(userId, id);
    if (!saved) return false;
    const occupied = saved.timetableData.filter((s) => s.status === "occupied");

    // Atomic replace: clear current slots + audit history, then insert snapshot.
    // If any step fails the transaction rolls back, leaving the prior grid intact.
    await db.transaction(async (tx) => {
      await tx.delete(timetableSlots).where(eq(timetableSlots.userId, userId));
      await tx.delete(timetableActions).where(eq(timetableActions.userId, userId));
      if (occupied.length > 0) {
        await tx.insert(timetableSlots).values(
          occupied.map((slot) => ({
            userId,
            day: slot.day,
            period: slot.period,
            schoolClass: slot.schoolClass,
            status: slot.status,
            subject: slot.subject,
            teacherId: slot.teacherId,
            slotType: slot.slotType,
            slashPairSubject: slot.slashPairSubject,
            slashPairTeacherId: slot.slashPairTeacherId,
          }))
        );
      }
    });
    return true;
  }
}

export const storage = new DatabaseStorage();
