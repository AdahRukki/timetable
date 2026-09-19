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

// Slash-group helpers — groups may contain two or three subjects and are kept
// bidirectional/exclusive. Existing two-way pairs remain fully compatible.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type SlashRow = {
  id: number;
  name: string;
  isSlashSubject: number;
  slashPairName: string | null;
  slashThirdName: string | null;
};

function declaredSlashMembers(row: SlashRow): string[] {
  return [row.name, row.slashPairName, row.slashThirdName]
    .filter((name): name is string => !!name);
}

async function clearSlashGroup(tx: Tx, userId: string, anchorName: string): Promise<void> {
  const rows = await tx.select().from(subjects).where(eq(subjects.userId, userId));
  const byName = new Map(rows.map((row) => [row.name, row]));
  const affected = new Set<string>([anchorName]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const names = declaredSlashMembers(row as SlashRow);
      if (!names.some((name) => affected.has(name))) continue;
      for (const name of names) {
        if (!affected.has(name)) {
          affected.add(name);
          changed = true;
        }
      }
    }
  }

  for (const name of Array.from(affected)) {
    const row = byName.get(name);
    if (!row) continue;
    await tx.update(subjects)
      .set({ isSlashSubject: 0, slashPairName: null, slashThirdName: null })
      .where(and(eq(subjects.userId, userId), eq(subjects.id, row.id)));
    await tx.update(subjectQuotas)
      .set({ isSlashSubject: 0 })
      .where(and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, name)));
  }
}

async function setSlashGroup(tx: Tx, userId: string, rawNames: string[]): Promise<void> {
  const names = Array.from(new Set(rawNames.filter(Boolean)));
  if (names.length < 2 || names.length > 3) return;

  const rows = await tx.select().from(subjects).where(eq(subjects.userId, userId));
  const byName = new Map(rows.map((row) => [row.name, row]));
  if (names.some((name) => !byName.has(name))) return;

  // Break any previous group touching any selected member before establishing
  // the new group. This prevents one subject from belonging to two groups.
  const touched = new Set<string>();
  for (const name of names) {
    const row = byName.get(name)!;
    for (const oldName of declaredSlashMembers(row as SlashRow)) touched.add(oldName);
  }
  for (const name of Array.from(touched)) {
    if (names.includes(name)) continue;
    const row = byName.get(name);
    if (!row) continue;
    await tx.update(subjects)
      .set({ isSlashSubject: 0, slashPairName: null, slashThirdName: null })
      .where(and(eq(subjects.userId, userId), eq(subjects.id, row.id)));
    await tx.update(subjectQuotas)
      .set({ isSlashSubject: 0 })
      .where(and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, name)));
  }

  for (const name of names) {
    const row = byName.get(name)!;
    const others = names.filter((n) => n !== name);
    await tx.update(subjects)
      .set({
        isSlashSubject: 1,
        slashPairName: others[0] ?? null,
        slashThirdName: others[1] ?? null,
      })
      .where(and(eq(subjects.userId, userId), eq(subjects.id, row.id)));
    await tx.update(subjectQuotas)
      .set({ isSlashSubject: 1 })
      .where(and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, name)));
  }
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
  /**
   * Atomic batch placement. All slots are written in a single transaction; if
   * `requireEmpty` is set, every target row is re-checked inside the tx and
   * the whole batch aborts (throwing) if any row is already occupied. Used by
   * the "apply to all classes" activity flow so partial bulk writes are
   * impossible.
   */
  setSlotsAtomic(userId: string, slots: TimetableSlot[], requireEmpty: boolean): Promise<TimetableSlot[]>;
  clearSlot(userId: string, day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined>;
  clearAllSlots(userId: string): Promise<void>;

  // Actions (for undo/redo)
  getActions(userId: string): Promise<TimetableAction[]>;
  addAction(userId: string, action: Omit<TimetableAction, "id">): Promise<TimetableAction>;
  clearActions(userId: string): Promise<void>;

  // Subject Quotas
  getSubjectQuotas(userId: string): Promise<SubjectQuota[]>;
  updateSubjectQuota(userId: string, subject: string, quota: Partial<SubjectQuota>): Promise<SubjectQuota | undefined>;
  updateSlashGroupQuota(
    userId: string,
    subjectNames: string[],
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2Quota" | "ss3Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<SubjectQuota[] | undefined>;
  updateSlashPairQuota(
    userId: string,
    subjectA: string,
    subjectB: string,
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2Quota" | "ss3Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<{ a: SubjectQuota; b: SubjectQuota } | undefined>;

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
      maxConsecutivePeriods: row.maxConsecutivePeriods ?? null,
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
      maxConsecutivePeriods: row.maxConsecutivePeriods ?? null,
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
      maxConsecutivePeriods: insertTeacher.maxConsecutivePeriods ?? null,
    });
    return { ...insertTeacher, id, maxConsecutivePeriods: insertTeacher.maxConsecutivePeriods ?? null };
  }

  async updateTeacher(userId: string, id: string, updates: Partial<InsertTeacher>): Promise<Teacher | undefined> {
    const existing = await this.getTeacher(userId, id);
    if (!existing) return undefined;

    const updateValues: Record<string, unknown> = {};
    if (updates.name !== undefined) updateValues.name = updates.name;
    if (updates.subjects !== undefined) updateValues.subjects = updates.subjects;
    if (updates.classes !== undefined) updateValues.classes = updates.classes;
    if (updates.subjectClasses !== undefined) updateValues.subjectClasses = updates.subjectClasses;
    if (updates.unavailable !== undefined) updateValues.unavailable = updates.unavailable;
    if (updates.color !== undefined) updateValues.color = updates.color;
    if (updates.maxConsecutivePeriods !== undefined) updateValues.maxConsecutivePeriods = updates.maxConsecutivePeriods;

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
            slashThirdSubject: null,
            slashThirdTeacherId: null,
            isLocked: false,
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
        slotType: row.slotType as "single" | "double" | "slash" | "activity" | null,
        slashPairSubject: row.slashPairSubject,
        slashPairTeacherId: row.slashPairTeacherId,
        slashThirdSubject: row.slashThirdSubject,
        slashThirdTeacherId: row.slashThirdTeacherId,
        isLocked: row.isLocked === 1,
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
        slashThirdSubject: null,
        slashThirdTeacherId: null,
        isLocked: false,
      };
    }

    return {
      day: row.day as Day,
      period: row.period,
      schoolClass: row.schoolClass as SchoolClass,
      status: row.status as "empty" | "occupied" | "break",
      subject: row.subject,
      teacherId: row.teacherId,
      slotType: row.slotType as "single" | "double" | "slash" | "activity" | null,
      slashPairSubject: row.slashPairSubject,
      slashPairTeacherId: row.slashPairTeacherId,
      slashThirdSubject: row.slashThirdSubject,
      slashThirdTeacherId: row.slashThirdTeacherId,
      isLocked: row.isLocked === 1,
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
        slashThirdSubject: slot.slashThirdSubject,
        slashThirdTeacherId: slot.slashThirdTeacherId,
        isLocked: slot.isLocked ? 1 : 0,
      });
    }

    return slot;
  }

  async setSlotsAtomic(
    userId: string,
    slots: TimetableSlot[],
    requireEmpty: boolean,
  ): Promise<TimetableSlot[]> {
    if (slots.length === 0) return [];
    return await db.transaction(async (tx) => {
      if (requireEmpty) {
        // Re-check every target row inside the tx so a concurrent placement
        // can't slip in between our pre-validation and these writes.
        for (const slot of slots) {
          const [existing] = await tx
            .select({ status: timetableSlots.status })
            .from(timetableSlots)
            .where(
              and(
                eq(timetableSlots.userId, userId),
                eq(timetableSlots.day, slot.day),
                eq(timetableSlots.schoolClass, slot.schoolClass),
                eq(timetableSlots.period, slot.period),
              ),
            );
          if (existing && existing.status === "occupied") {
            throw new Error(
              `SLOT_OCCUPIED:${slot.day}:${slot.schoolClass}:${slot.period}`,
            );
          }
        }
      }

      for (const slot of slots) {
        await tx.delete(timetableSlots).where(
          and(
            eq(timetableSlots.userId, userId),
            eq(timetableSlots.day, slot.day),
            eq(timetableSlots.schoolClass, slot.schoolClass),
            eq(timetableSlots.period, slot.period),
          ),
        );
        if (slot.status !== "empty") {
          await tx.insert(timetableSlots).values({
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
            slashThirdSubject: slot.slashThirdSubject,
            slashThirdTeacherId: slot.slashThirdTeacherId,
            isLocked: slot.isLocked ? 1 : 0,
          });
        }
      }
      return slots;
    });
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
      slashThirdSubject: null,
      slashThirdTeacherId: null,
      isLocked: false,
    };
  }

  // Bulk-clear used by Clear & Generate. Locked rows (isLocked = 1) are
  // preserved so fixed periods and non-teaching activities survive a regen.
  async clearAllSlots(userId: string): Promise<void> {
    await db.delete(timetableSlots).where(
      and(
        eq(timetableSlots.userId, userId),
        eq(timetableSlots.isLocked, 0),
      )
    );
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
      jss1Quota: row.jss1Quota ?? row.jssQuota,
      jss2Quota: row.jss2Quota ?? row.jssQuota,
      jss3Quota: row.jss3Quota ?? row.jssQuota,
      ss1Quota: row.ss1Quota,
      ss2Quota: row.ss2Quota ?? row.ss2ss3Quota,
      ss3Quota: row.ss3Quota ?? row.ss2ss3Quota,
      ss2ss3Quota: row.ss2ss3Quota,
      isSlashSubject: row.isSlashSubject === 1,
      singleOnly: row.singleOnly === 1,
      preferredPeriods: row.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] },
      requiredDoubles: row.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 },
    }));
  }

  async updateSubjectQuota(userId: string, subject: string, updates: Partial<SubjectQuota>): Promise<SubjectQuota | undefined> {
    const [existing] = await db.select().from(subjectQuotas).where(
      and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, subject))
    );
    if (!existing) return undefined;

    const updateValues: Record<string, unknown> = {};
    if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
    if (updates.jss1Quota !== undefined) updateValues.jss1Quota = updates.jss1Quota;
    if (updates.jss2Quota !== undefined) updateValues.jss2Quota = updates.jss2Quota;
    if (updates.jss3Quota !== undefined) updateValues.jss3Quota = updates.jss3Quota;
    if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;
    if (updates.ss2Quota !== undefined) updateValues.ss2Quota = updates.ss2Quota;
    if (updates.ss3Quota !== undefined) updateValues.ss3Quota = updates.ss3Quota;
    if (updates.ss2ss3Quota !== undefined) updateValues.ss2ss3Quota = updates.ss2ss3Quota;
    if (updates.isSlashSubject !== undefined) updateValues.isSlashSubject = updates.isSlashSubject ? 1 : 0;
    if (updates.preferredPeriods !== undefined) updateValues.preferredPeriods = updates.preferredPeriods;
    if (updates.requiredDoubles !== undefined) updateValues.requiredDoubles = updates.requiredDoubles;

    await db.update(subjectQuotas).set(updateValues).where(
      and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, subject))
    );

    return {
      subject: existing.subject,
      jssQuota: updates.jssQuota ?? existing.jssQuota,
      jss1Quota: updates.jss1Quota ?? existing.jss1Quota ?? existing.jssQuota,
      jss2Quota: updates.jss2Quota ?? existing.jss2Quota ?? existing.jssQuota,
      jss3Quota: updates.jss3Quota ?? existing.jss3Quota ?? existing.jssQuota,
      ss1Quota: updates.ss1Quota ?? existing.ss1Quota,
      ss2Quota: updates.ss2Quota ?? existing.ss2Quota ?? existing.ss2ss3Quota,
      ss3Quota: updates.ss3Quota ?? existing.ss3Quota ?? existing.ss2ss3Quota,
      ss2ss3Quota: updates.ss2ss3Quota ?? existing.ss2ss3Quota,
      isSlashSubject: updates.isSlashSubject ?? (existing.isSlashSubject === 1),
      singleOnly: existing.singleOnly === 1,
      preferredPeriods: updates.preferredPeriods ?? existing.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] },
      requiredDoubles: updates.requiredDoubles ?? existing.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 },
    };
  }

  async updateSlashGroupQuota(
    userId: string,
    subjectNames: string[],
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2Quota" | "ss3Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<SubjectQuota[] | undefined> {
    const names = Array.from(new Set(subjectNames.filter(Boolean)));
    if (names.length < 2 || names.length > 3) return undefined;
    const setValues: Record<string, number> = { [field]: value };

    return await db.transaction(async (tx) => {
      const rows = [];
      for (const name of names) {
        const [row] = await tx.select().from(subjectQuotas).where(
          and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, name))
        );
        if (!row) return undefined;
        rows.push(row);
      }

      for (const name of names) {
        await tx.update(subjectQuotas).set(setValues).where(
          and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, name))
        );
        // Keep the editable subject record in sync with the quota table.
        await tx.update(subjects).set(setValues).where(
          and(eq(subjects.userId, userId), eq(subjects.name, name))
        );
      }

      return rows.map((row) => ({
        subject: row.subject,
        jssQuota: field === "jssQuota" ? value : row.jssQuota,
        jss1Quota: field === "jss1Quota" ? value : (row.jss1Quota ?? row.jssQuota),
        jss2Quota: field === "jss2Quota" ? value : (row.jss2Quota ?? row.jssQuota),
        jss3Quota: field === "jss3Quota" ? value : (row.jss3Quota ?? row.jssQuota),
        ss1Quota: field === "ss1Quota" ? value : row.ss1Quota,
        ss2Quota: field === "ss2Quota" ? value : (row.ss2Quota ?? row.ss2ss3Quota),
        ss3Quota: field === "ss3Quota" ? value : (row.ss3Quota ?? row.ss2ss3Quota),
        ss2ss3Quota: field === "ss2ss3Quota" ? value : row.ss2ss3Quota,
        isSlashSubject: row.isSlashSubject === 1,
        singleOnly: row.singleOnly === 1,
        preferredPeriods: row.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] },
        requiredDoubles: row.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 },
      }));
    });
  }

  async updateSlashPairQuota(
    userId: string,
    subjectA: string,
    subjectB: string,
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2Quota" | "ss3Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<{ a: SubjectQuota; b: SubjectQuota } | undefined> {
    const result = await this.updateSlashGroupQuota(userId, [subjectA, subjectB], field, value);
    return result ? { a: result[0], b: result[1] } : undefined;
  }

  // Subjects
  async getSubjects(userId: string): Promise<Subject[]> {
    const rows = await db.select().from(subjects).where(eq(subjects.userId, userId));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      jssQuota: row.jssQuota,
      jss1Quota: row.jss1Quota ?? row.jssQuota,
      jss2Quota: row.jss2Quota ?? row.jssQuota,
      jss3Quota: row.jss3Quota ?? row.jssQuota,
      ss1Quota: row.ss1Quota,
      ss2Quota: row.ss2Quota ?? row.ss2ss3Quota,
      ss3Quota: row.ss3Quota ?? row.ss2ss3Quota,
      ss2ss3Quota: row.ss2ss3Quota,
      isSlashSubject: row.isSlashSubject === 1,
      slashPairName: row.slashPairName,
      slashThirdName: row.slashThirdName,
      singleOnly: row.singleOnly === 1,
      preferredPeriods: row.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] },
      requiredDoubles: row.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 },
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
      jss1Quota: row.jss1Quota ?? row.jssQuota,
      jss2Quota: row.jss2Quota ?? row.jssQuota,
      jss3Quota: row.jss3Quota ?? row.jssQuota,
      ss1Quota: row.ss1Quota,
      ss2Quota: row.ss2Quota ?? row.ss2ss3Quota,
      ss3Quota: row.ss3Quota ?? row.ss2ss3Quota,
      ss2ss3Quota: row.ss2ss3Quota,
      isSlashSubject: row.isSlashSubject === 1,
      slashPairName: row.slashPairName,
      slashThirdName: row.slashThirdName,
      singleOnly: row.singleOnly === 1,
      preferredPeriods: row.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] },
      requiredDoubles: row.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 },
    };
  }

  async createSubject(userId: string, subject: InsertSubject): Promise<Subject> {
    const preferredPeriods = subject.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] };
    const jss1Quota = subject.jss1Quota ?? subject.jssQuota;
    const jss2Quota = subject.jss2Quota ?? subject.jssQuota;
    const jss3Quota = subject.jss3Quota ?? subject.jssQuota;
    const ss2Quota = subject.ss2Quota ?? subject.ss2ss3Quota;
    const ss3Quota = subject.ss3Quota ?? subject.ss2ss3Quota;
    const singleOnly = subject.singleOnly ?? false;
    const requiredDoubles = singleOnly
      ? { jss: 0, ss1: 0, ss2ss3: 0 }
      : (subject.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 });
    return await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(subjects).values({
        userId,
        name: subject.name,
        jssQuota: subject.jssQuota,
        jss1Quota,
        jss2Quota,
        jss3Quota,
        ss1Quota: subject.ss1Quota,
        ss2Quota,
        ss3Quota,
        ss2ss3Quota: subject.ss2ss3Quota,
        isSlashSubject: subject.isSlashSubject ? 1 : 0,
        slashPairName: subject.isSlashSubject ? subject.slashPairName : null,
        slashThirdName: subject.isSlashSubject ? subject.slashThirdName : null,
        singleOnly: singleOnly ? 1 : 0,
        preferredPeriods,
        requiredDoubles,
      }).returning({ id: subjects.id });

      await tx.insert(subjectQuotas).values({
        userId,
        subject: subject.name,
        jssQuota: subject.jssQuota,
        jss1Quota,
        jss2Quota,
        jss3Quota,
        ss1Quota: subject.ss1Quota,
        ss2Quota,
        ss3Quota,
        ss2ss3Quota: subject.ss2ss3Quota,
        isSlashSubject: subject.isSlashSubject ? 1 : 0,
        singleOnly: singleOnly ? 1 : 0,
        preferredPeriods,
        requiredDoubles,
      }).onConflictDoNothing();

      if (subject.isSlashSubject && subject.slashPairName) {
        await setSlashGroup(tx, userId, [subject.name, subject.slashPairName, subject.slashThirdName ?? ""]);
      }

      return {
        id: inserted.id,
        name: subject.name,
        jssQuota: subject.jssQuota,
        jss1Quota,
        jss2Quota,
        jss3Quota,
        ss1Quota: subject.ss1Quota,
        ss2Quota,
        ss3Quota,
        ss2ss3Quota: subject.ss2ss3Quota,
        isSlashSubject: subject.isSlashSubject,
        slashPairName: subject.isSlashSubject ? subject.slashPairName : null,
        slashThirdName: subject.isSlashSubject ? subject.slashThirdName : null,
        singleOnly,
        preferredPeriods,
        requiredDoubles,
      };
    });
  }

  async updateSubject(userId: string, id: number, updates: Partial<InsertSubject>): Promise<Subject | undefined> {
    const existing = await this.getSubject(userId, id);
    if (!existing) return undefined;

    return await db.transaction(async (tx) => {
      const newName = updates.name ?? existing.name;
      const newSlash = updates.isSlashSubject ?? existing.isSlashSubject;
      const newPair = newSlash
        ? (updates.slashPairName !== undefined ? updates.slashPairName : existing.slashPairName)
        : null;
      const newThird = newSlash
        ? (updates.slashThirdName !== undefined ? updates.slashThirdName : existing.slashThirdName)
        : null;
      const newSingleOnly = updates.singleOnly ?? existing.singleOnly;
      const newRequiredDoubles = newSingleOnly
        ? { jss: 0, ss1: 0, ss2ss3: 0 }
        : (updates.requiredDoubles ?? existing.requiredDoubles);

      // Break the prior slash group first, then establish the desired group
      // after the subject row has been updated/renamed.
      if (existing.isSlashSubject) {
        await clearSlashGroup(tx, userId, existing.name);
      }

      const updateValues: Record<string, unknown> = {};
      if (updates.name !== undefined) updateValues.name = newName;
      if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
      if (updates.jss1Quota !== undefined) updateValues.jss1Quota = updates.jss1Quota;
      if (updates.jss2Quota !== undefined) updateValues.jss2Quota = updates.jss2Quota;
      if (updates.jss3Quota !== undefined) updateValues.jss3Quota = updates.jss3Quota;
      if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;
      if (updates.ss2Quota !== undefined) updateValues.ss2Quota = updates.ss2Quota;
      if (updates.ss3Quota !== undefined) updateValues.ss3Quota = updates.ss3Quota;
      if (updates.ss2ss3Quota !== undefined) updateValues.ss2ss3Quota = updates.ss2ss3Quota;
      updateValues.isSlashSubject = newSlash ? 1 : 0;
      updateValues.slashPairName = newPair;
      updateValues.slashThirdName = newThird;
      if (updates.preferredPeriods !== undefined) updateValues.preferredPeriods = updates.preferredPeriods;
      if (updates.singleOnly !== undefined) updateValues.singleOnly = newSingleOnly ? 1 : 0;
      if (updates.requiredDoubles !== undefined || updates.singleOnly === true) updateValues.requiredDoubles = newRequiredDoubles;

      await tx.update(subjects).set(updateValues).where(
        and(eq(subjects.userId, userId), eq(subjects.id, id))
      );

      const quotaUpdates: Record<string, unknown> = {};
      if (updates.jssQuota !== undefined) quotaUpdates.jssQuota = updates.jssQuota;
      if (updates.jss1Quota !== undefined) quotaUpdates.jss1Quota = updates.jss1Quota;
      if (updates.jss2Quota !== undefined) quotaUpdates.jss2Quota = updates.jss2Quota;
      if (updates.jss3Quota !== undefined) quotaUpdates.jss3Quota = updates.jss3Quota;
      if (updates.ss1Quota !== undefined) quotaUpdates.ss1Quota = updates.ss1Quota;
      if (updates.ss2Quota !== undefined) quotaUpdates.ss2Quota = updates.ss2Quota;
      if (updates.ss3Quota !== undefined) quotaUpdates.ss3Quota = updates.ss3Quota;
      if (updates.ss2ss3Quota !== undefined) quotaUpdates.ss2ss3Quota = updates.ss2ss3Quota;
      quotaUpdates.isSlashSubject = newSlash ? 1 : 0;
      if (updates.preferredPeriods !== undefined) quotaUpdates.preferredPeriods = updates.preferredPeriods;
      if (updates.singleOnly !== undefined) quotaUpdates.singleOnly = newSingleOnly ? 1 : 0;
      if (updates.requiredDoubles !== undefined || updates.singleOnly === true) quotaUpdates.requiredDoubles = newRequiredDoubles;

      await tx.update(subjectQuotas).set(quotaUpdates).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
      );

      if (updates.name && updates.name !== existing.name) {
        await tx.update(subjectQuotas).set({ subject: newName }).where(
          and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
        );
      }

      if (newSlash && newPair) {
        await setSlashGroup(tx, userId, [newName, newPair, newThird ?? ""]);
      }

      return {
        id: existing.id,
        name: newName,
        jssQuota: updates.jssQuota ?? existing.jssQuota,
        jss1Quota: updates.jss1Quota ?? existing.jss1Quota ?? existing.jssQuota,
        jss2Quota: updates.jss2Quota ?? existing.jss2Quota ?? existing.jssQuota,
        jss3Quota: updates.jss3Quota ?? existing.jss3Quota ?? existing.jssQuota,
        ss1Quota: updates.ss1Quota ?? existing.ss1Quota,
        ss2Quota: updates.ss2Quota ?? existing.ss2Quota ?? existing.ss2ss3Quota,
        ss3Quota: updates.ss3Quota ?? existing.ss3Quota ?? existing.ss2ss3Quota,
        ss2ss3Quota: updates.ss2ss3Quota ?? existing.ss2ss3Quota,
        isSlashSubject: newSlash,
        slashPairName: newPair,
        slashThirdName: newThird,
        singleOnly: newSingleOnly,
        preferredPeriods: updates.preferredPeriods ?? existing.preferredPeriods,
        requiredDoubles: newRequiredDoubles,
      };
    });
  }

  async deleteSubject(userId: string, id: number): Promise<boolean> {
    const existing = await this.getSubject(userId, id);
    if (!existing) return false;

    await db.transaction(async (tx) => {
      if (existing.isSlashSubject) {
        await clearSlashGroup(tx, userId, existing.name);
      }
      await tx.delete(subjects).where(
        and(eq(subjects.userId, userId), eq(subjects.id, id))
      );
      await tx.delete(subjectQuotas).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
      );
    });

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
        freePeriodsPerClass: (row.freePeriodsPerClass ?? {}) as Record<string, number>,
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
      freePeriodsPerClass: {},
      allowDoublePeriods: 1,
      allowDoubleInP8P9: 1,
    });
    return {
      fatigueLimit: 5,
      maxFreePeriodsPerWeek: 3,
      maxFreePeriodsPerDay: 2,
      freePeriodsPerClass: {},
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
      freePeriodsPerClass: newSettings.freePeriodsPerClass ?? {},
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
    const result = await db.delete(savedTimetables).where(
      and(eq(savedTimetables.id, id), eq(savedTimetables.userId, userId))
    );
    return (result.rowCount ?? 0) > 0;
  }

  async loadSavedTimetable(userId: string, id: string): Promise<boolean> {
    const saved = await this.getSavedTimetable(userId, id);
    if (!saved) return false;
    // The snapshot stores every slot (full grid). The live timetable_slots
    // table only stores occupied rows (empty cells are inferred), so we
    // filter at the DB-write boundary while keeping the snapshot intact.
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
            slashThirdSubject: slot.slashThirdSubject,
            slashThirdTeacherId: slot.slashThirdTeacherId,
          }))
        );
      }
    });
    return true;
  }
}

export const storage = new DatabaseStorage();
