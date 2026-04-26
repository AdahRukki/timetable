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
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

function getSlotKey(day: Day, schoolClass: SchoolClass, period: number): string {
  return `${day}-${schoolClass}-${period}`;
}

// Slash-pair helpers — keep slash pairings bidirectional and exclusive.
// Both helpers operate inside an active transaction so reconciliation is atomic
// with the primary subject mutation.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function clearSlashPartnerIfPointingAt(
  tx: Tx,
  userId: string,
  partnerName: string,
  expectedBackpointer: string,
): Promise<void> {
  const [partner] = await tx.select().from(subjects).where(
    and(eq(subjects.userId, userId), eq(subjects.name, partnerName))
  );
  if (!partner) return;
  if (partner.slashPairName !== expectedBackpointer) return;
  await tx.update(subjects)
    .set({ isSlashSubject: 0, slashPairName: null })
    .where(and(eq(subjects.userId, userId), eq(subjects.id, partner.id)));
  await tx.update(subjectQuotas)
    .set({ isSlashSubject: 0 })
    .where(and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, partner.name)));
}

async function mirrorSlashPair(
  tx: Tx,
  userId: string,
  ownerName: string,
  partnerName: string,
): Promise<void> {
  const [partner] = await tx.select().from(subjects).where(
    and(eq(subjects.userId, userId), eq(subjects.name, partnerName))
  );
  if (!partner) return; // partner doesn't exist; pairing is one-sided until they create it

  // If the partner was previously paired with someone else, break that pairing.
  if (partner.isSlashSubject === 1 && partner.slashPairName && partner.slashPairName !== ownerName) {
    await clearSlashPartnerIfPointingAt(tx, userId, partner.slashPairName, partner.name);
  }

  await tx.update(subjects)
    .set({ isSlashSubject: 1, slashPairName: ownerName })
    .where(and(eq(subjects.userId, userId), eq(subjects.id, partner.id)));
  await tx.update(subjectQuotas)
    .set({ isSlashSubject: 1 })
    .where(and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, partner.name)));
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
  // True wipe: deletes every timetable row for the user, including locked
  // fixed periods and non-teaching activities. Used by the "Reset timetable"
  // button. Distinct from clearAllSlots, which preserves locked rows for the
  // auto-generator's "Clear & Generate" workflow.
  wipeAllSlots(userId: string): Promise<void>;

  // Actions (for undo/redo)
  getActions(userId: string): Promise<TimetableAction[]>;
  addAction(userId: string, action: Omit<TimetableAction, "id">): Promise<TimetableAction>;
  clearActions(userId: string): Promise<void>;

  // Subject Quotas
  getSubjectQuotas(userId: string): Promise<SubjectQuota[]>;
  updateSubjectQuota(userId: string, subject: string, quota: Partial<SubjectQuota>): Promise<SubjectQuota | undefined>;
  updateSlashPairQuota(
    userId: string,
    subjectA: string,
    subjectB: string,
    field: "jssQuota" | "ss1Quota" | "ss2ss3Quota",
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
            isLocked: slot.isLocked ? 1 : 0,
          });
        }
      }
      return slots;
    });
  }

  async clearSlot(userId: string, day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined> {
    // A double period is stored as TWO rows (period N and N+1) sharing the
    // same subject and slotType="double". When the user removes either half
    // of a double we must delete the partner row too — otherwise the orphan
    // half survives in the DB and the auto-generator treats it as a still-
    // existing locked period and re-renders it on the grid, making the
    // "deleted" fixed period appear to come back.
    const existing = await this.getSlot(userId, day, schoolClass, period);
    const periodsToDelete = new Set<number>([period]);
    if (existing?.status === "occupied" && existing.slotType === "double") {
      const partnerCandidates = [period - 1, period + 1].filter((p) => p >= 1);
      for (const p of partnerCandidates) {
        const partner = await this.getSlot(userId, day, schoolClass, p);
        if (
          partner?.status === "occupied" &&
          partner.slotType === "double" &&
          partner.subject === existing.subject
        ) {
          periodsToDelete.add(p);
        }
      }
    }

    await db.delete(timetableSlots).where(
      and(
        eq(timetableSlots.userId, userId),
        eq(timetableSlots.day, day),
        eq(timetableSlots.schoolClass, schoolClass),
        inArray(timetableSlots.period, Array.from(periodsToDelete))
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

  // True wipe used by the "Reset timetable" button — removes every row
  // unconditionally, including locked fixed periods and activities.
  async wipeAllSlots(userId: string): Promise<void> {
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
    if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;
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
      ss1Quota: updates.ss1Quota ?? existing.ss1Quota,
      ss2ss3Quota: updates.ss2ss3Quota ?? existing.ss2ss3Quota,
      isSlashSubject: updates.isSlashSubject ?? (existing.isSlashSubject === 1),
      preferredPeriods: updates.preferredPeriods ?? existing.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] },
      requiredDoubles: updates.requiredDoubles ?? existing.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 },
    };
  }

  async updateSlashPairQuota(
    userId: string,
    subjectA: string,
    subjectB: string,
    field: "jssQuota" | "ss1Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<{ a: SubjectQuota; b: SubjectQuota } | undefined> {
    const setValues: Partial<Record<"jssQuota" | "ss1Quota" | "ss2ss3Quota", number>> = {
      [field]: value,
    };

    return await db.transaction(async (tx) => {
      const [a] = await tx.select().from(subjectQuotas).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, subjectA))
      );
      const [b] = await tx.select().from(subjectQuotas).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, subjectB))
      );
      if (!a || !b) return undefined;

      await tx.update(subjectQuotas).set(setValues).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, subjectA))
      );
      await tx.update(subjectQuotas).set(setValues).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, subjectB))
      );

      const toQuota = (row: typeof a): SubjectQuota => ({
        subject: row.subject,
        jssQuota: field === "jssQuota" ? value : row.jssQuota,
        ss1Quota: field === "ss1Quota" ? value : row.ss1Quota,
        ss2ss3Quota: field === "ss2ss3Quota" ? value : row.ss2ss3Quota,
        isSlashSubject: row.isSlashSubject === 1,
        preferredPeriods: row.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] },
        requiredDoubles: row.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 },
      });

      return { a: toQuota(a), b: toQuota(b) };
    });
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
      ss1Quota: row.ss1Quota,
      ss2ss3Quota: row.ss2ss3Quota,
      isSlashSubject: row.isSlashSubject === 1,
      slashPairName: row.slashPairName,
      preferredPeriods: row.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] },
      requiredDoubles: row.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 },
    };
  }

  async createSubject(userId: string, subject: InsertSubject): Promise<Subject> {
    const preferredPeriods = subject.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] };
    const requiredDoubles = subject.requiredDoubles ?? { jss: 0, ss1: 0, ss2ss3: 0 };
    return await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(subjects).values({
        userId,
        name: subject.name,
        jssQuota: subject.jssQuota,
        ss1Quota: subject.ss1Quota,
        ss2ss3Quota: subject.ss2ss3Quota,
        isSlashSubject: subject.isSlashSubject ? 1 : 0,
        slashPairName: subject.isSlashSubject ? subject.slashPairName : null,
        preferredPeriods,
        requiredDoubles,
      }).returning({ id: subjects.id });

      await tx.insert(subjectQuotas).values({
        userId,
        subject: subject.name,
        jssQuota: subject.jssQuota,
        ss1Quota: subject.ss1Quota,
        ss2ss3Quota: subject.ss2ss3Quota,
        isSlashSubject: subject.isSlashSubject ? 1 : 0,
        preferredPeriods,
        requiredDoubles,
      }).onConflictDoNothing();

      if (subject.isSlashSubject && subject.slashPairName) {
        await mirrorSlashPair(tx, userId, subject.name, subject.slashPairName);
      }

      return {
        id: inserted.id,
        name: subject.name,
        jssQuota: subject.jssQuota,
        ss1Quota: subject.ss1Quota,
        ss2ss3Quota: subject.ss2ss3Quota,
        isSlashSubject: subject.isSlashSubject,
        slashPairName: subject.isSlashSubject ? subject.slashPairName : null,
        preferredPeriods,
        requiredDoubles,
      };
    });
  }

  async updateSubject(userId: string, id: number, updates: Partial<InsertSubject>): Promise<Subject | undefined> {
    const existing = await this.getSubject(userId, id);
    if (!existing) return undefined;

    return await db.transaction(async (tx) => {
      // Compute the desired post-update state.
      const newName = updates.name ?? existing.name;
      const newSlash = updates.isSlashSubject ?? existing.isSlashSubject;
      const newPair = newSlash
        ? (updates.slashPairName !== undefined ? updates.slashPairName : existing.slashPairName)
        : null;

      const updateValues: Record<string, unknown> = {};
      if (updates.name !== undefined) updateValues.name = newName;
      if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
      if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;
      if (updates.ss2ss3Quota !== undefined) updateValues.ss2ss3Quota = updates.ss2ss3Quota;
      if (updates.isSlashSubject !== undefined || updates.slashPairName !== undefined) {
        updateValues.isSlashSubject = newSlash ? 1 : 0;
        updateValues.slashPairName = newPair;
      }
      if (updates.preferredPeriods !== undefined) updateValues.preferredPeriods = updates.preferredPeriods;
      if (updates.requiredDoubles !== undefined) updateValues.requiredDoubles = updates.requiredDoubles;

      if (Object.keys(updateValues).length > 0) {
        await tx.update(subjects).set(updateValues).where(
          and(eq(subjects.userId, userId), eq(subjects.id, id))
        );
      }

      // Mirror name/quotas/isSlashSubject/preferences into subject_quotas.
      const quotaUpdates: Record<string, unknown> = {};
      if (updates.jssQuota !== undefined) quotaUpdates.jssQuota = updates.jssQuota;
      if (updates.ss1Quota !== undefined) quotaUpdates.ss1Quota = updates.ss1Quota;
      if (updates.ss2ss3Quota !== undefined) quotaUpdates.ss2ss3Quota = updates.ss2ss3Quota;
      if (updates.isSlashSubject !== undefined) quotaUpdates.isSlashSubject = newSlash ? 1 : 0;
      if (updates.preferredPeriods !== undefined) quotaUpdates.preferredPeriods = updates.preferredPeriods;
      if (updates.requiredDoubles !== undefined) quotaUpdates.requiredDoubles = updates.requiredDoubles;

      if (Object.keys(quotaUpdates).length > 0) {
        await tx.update(subjectQuotas).set(quotaUpdates).where(
          and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
        );
      }

      if (updates.name && updates.name !== existing.name) {
        await tx.update(subjectQuotas).set({ subject: newName }).where(
          and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
        );
      }

      // Slash pairing reconciliation.
      const oldPair = existing.isSlashSubject ? existing.slashPairName : null;
      const pairingChanged =
        oldPair !== newPair ||
        (existing.name !== newName && oldPair); // renaming a paired subject also requires re-mirroring

      if (pairingChanged) {
        // Break the old partner's back-pointer if it still points at us.
        if (oldPair) {
          await clearSlashPartnerIfPointingAt(tx, userId, oldPair, existing.name);
        }
        // Establish the new pairing on the partner side.
        if (newPair) {
          await mirrorSlashPair(tx, userId, newName, newPair);
        }
      } else if (existing.name !== newName && newPair) {
        // Same partner, but our name changed — update the partner's back-pointer.
        await tx.update(subjects)
          .set({ slashPairName: newName })
          .where(and(eq(subjects.userId, userId), eq(subjects.name, newPair)));
      }

      return {
        id: existing.id,
        name: newName,
        jssQuota: updates.jssQuota ?? existing.jssQuota,
        ss1Quota: updates.ss1Quota ?? existing.ss1Quota,
        ss2ss3Quota: updates.ss2ss3Quota ?? existing.ss2ss3Quota,
        isSlashSubject: newSlash,
        slashPairName: newPair,
        preferredPeriods: updates.preferredPeriods ?? existing.preferredPeriods,
        requiredDoubles: updates.requiredDoubles ?? existing.requiredDoubles,
      };
    });
  }

  async deleteSubject(userId: string, id: number): Promise<boolean> {
    const existing = await this.getSubject(userId, id);
    if (!existing) return false;

    await db.transaction(async (tx) => {
      await tx.delete(subjects).where(
        and(eq(subjects.userId, userId), eq(subjects.id, id))
      );

      await tx.delete(subjectQuotas).where(
        and(eq(subjectQuotas.userId, userId), eq(subjectQuotas.subject, existing.name))
      );

      // Clear the partner's back-pointer if it still points at the deleted subject.
      if (existing.isSlashSubject && existing.slashPairName) {
        await clearSlashPartnerIfPointingAt(tx, userId, existing.slashPairName, existing.name);
      }
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
          }))
        );
      }
    });
    return true;
  }
}

export const storage = new DatabaseStorage();
