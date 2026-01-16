import {
  type Teacher,
  type InsertTeacher,
  type TimetableSlot,
  type TimetableAction,
  type PlacementRequest,
  type ValidationResult,
  type Day,
  type SchoolClass,
  DAYS,
  CLASSES,
  PERIODS_PER_DAY,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Teachers
  getTeachers(): Promise<Teacher[]>;
  getTeacher(id: string): Promise<Teacher | undefined>;
  createTeacher(teacher: InsertTeacher): Promise<Teacher>;
  updateTeacher(id: string, teacher: Partial<InsertTeacher>): Promise<Teacher | undefined>;
  deleteTeacher(id: string): Promise<boolean>;

  // Timetable
  getTimetable(): Promise<Map<string, TimetableSlot>>;
  getSlot(day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined>;
  setSlot(slot: TimetableSlot): Promise<TimetableSlot>;
  clearSlot(day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined>;

  // Actions (for undo/redo)
  getActions(): Promise<TimetableAction[]>;
  addAction(action: Omit<TimetableAction, "id">): Promise<TimetableAction>;
  clearActions(): Promise<void>;
}

function getSlotKey(day: Day, schoolClass: SchoolClass, period: number): string {
  return `${day}-${schoolClass}-${period}`;
}

function initializeEmptyTimetable(): Map<string, TimetableSlot> {
  const timetable = new Map<string, TimetableSlot>();
  
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
  
  return timetable;
}

export class MemStorage implements IStorage {
  private teachers: Map<string, Teacher>;
  private timetable: Map<string, TimetableSlot>;
  private actions: TimetableAction[];

  constructor() {
    this.teachers = new Map();
    this.timetable = initializeEmptyTimetable();
    this.actions = [];
  }

  // Teachers
  async getTeachers(): Promise<Teacher[]> {
    return Array.from(this.teachers.values());
  }

  async getTeacher(id: string): Promise<Teacher | undefined> {
    return this.teachers.get(id);
  }

  async createTeacher(insertTeacher: InsertTeacher): Promise<Teacher> {
    const id = randomUUID();
    const teacher: Teacher = { ...insertTeacher, id };
    this.teachers.set(id, teacher);
    return teacher;
  }

  async updateTeacher(id: string, updates: Partial<InsertTeacher>): Promise<Teacher | undefined> {
    const teacher = this.teachers.get(id);
    if (!teacher) return undefined;
    
    const updated = { ...teacher, ...updates };
    this.teachers.set(id, updated);
    return updated;
  }

  async deleteTeacher(id: string): Promise<boolean> {
    return this.teachers.delete(id);
  }

  // Timetable
  async getTimetable(): Promise<Map<string, TimetableSlot>> {
    return new Map(this.timetable);
  }

  async getSlot(day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined> {
    return this.timetable.get(getSlotKey(day, schoolClass, period));
  }

  async setSlot(slot: TimetableSlot): Promise<TimetableSlot> {
    const key = getSlotKey(slot.day, slot.schoolClass, slot.period);
    this.timetable.set(key, slot);
    return slot;
  }

  async clearSlot(day: Day, schoolClass: SchoolClass, period: number): Promise<TimetableSlot | undefined> {
    const key = getSlotKey(day, schoolClass, period);
    const existing = this.timetable.get(key);
    if (!existing) return undefined;
    
    const cleared: TimetableSlot = {
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
    this.timetable.set(key, cleared);
    return cleared;
  }

  // Actions
  async getActions(): Promise<TimetableAction[]> {
    return [...this.actions];
  }

  async addAction(action: Omit<TimetableAction, "id">): Promise<TimetableAction> {
    const newAction: TimetableAction = {
      ...action,
      id: randomUUID(),
    };
    this.actions.push(newAction);
    return newAction;
  }

  async clearActions(): Promise<void> {
    this.actions = [];
  }
}

export const storage = new MemStorage();
