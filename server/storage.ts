import {
  type Teacher,
  type InsertTeacher,
  type TimetableSlot,
  type TimetableAction,
  type PlacementRequest,
  type ValidationResult,
  type Day,
  type SchoolClass,
  type SubjectQuota,
  DAYS,
  CLASSES,
  PERIODS_PER_DAY,
  DEFAULT_QUOTAS,
} from "@shared/schema";
import { randomUUID } from "crypto";

const TEACHER_COLORS = [
  "#8884d8", "#82ca9d", "#ffc658", "#ff7c43", "#a4de6c",
  "#d0ed57", "#83a6ed", "#8dd1e1", "#a4de6c", "#d88484",
  "#c084d8", "#84d8c0", "#d8b384", "#84a8d8", "#d884a8",
];

function getTeacherColor(index: number): string {
  return TEACHER_COLORS[index % TEACHER_COLORS.length];
}

const initialTeachers: Teacher[] = [
  { id: "T1", name: "Mr. Adewale", subjects: ["Maths"], classes: [...CLASSES] as SchoolClass[], unavailable: {}, color: getTeacherColor(0) },
  { id: "T2", name: "Mrs. Okonkwo", subjects: ["English"], classes: [...CLASSES] as SchoolClass[], unavailable: {}, color: getTeacherColor(1) },
  { id: "T3", name: "Mr. Ibrahim", subjects: ["Basic Science", "Physics"], classes: [...CLASSES] as SchoolClass[], unavailable: { Tuesday: [1, 2] }, color: getTeacherColor(2) },
  { id: "T4", name: "Mrs. Bello", subjects: ["Chemistry"], classes: ["SS1", "SS2", "SS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(3) },
  { id: "T5", name: "Mr. Eze", subjects: ["Biology", "Basic Science"], classes: [...CLASSES] as SchoolClass[], unavailable: { Friday: [1] }, color: getTeacherColor(4) },
  { id: "T6", name: "Mrs. Abubakar", subjects: ["Social Studies", "Civic"], classes: ["JSS1", "JSS2", "JSS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(5) },
  { id: "T7", name: "Mr. Chukwu", subjects: ["Basic Technology"], classes: ["JSS1", "JSS2", "JSS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(6) },
  { id: "T8", name: "Mrs. Danjuma", subjects: ["Home Economics"], classes: ["JSS1", "JSS2", "JSS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(7) },
  { id: "T9", name: "Mr. Oluwole", subjects: ["Computer"], classes: [...CLASSES] as SchoolClass[], unavailable: {}, color: getTeacherColor(8) },
  { id: "T10", name: "Mrs. Yakubu", subjects: ["PHE"], classes: [...CLASSES] as SchoolClass[], unavailable: {}, color: getTeacherColor(9) },
  { id: "T11", name: "Mr. Ogunyemi", subjects: ["CRS"], classes: [...CLASSES] as SchoolClass[], unavailable: {}, color: getTeacherColor(10) },
  { id: "T12", name: "Mrs. Ahmed", subjects: ["Agric"], classes: [...CLASSES] as SchoolClass[], unavailable: { Wednesday: [8, 9] }, color: getTeacherColor(11) },
  { id: "T13", name: "Mr. Adeniyi", subjects: ["Security"], classes: ["JSS1", "JSS2", "JSS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(12) },
  { id: "T14", name: "Mrs. Idris", subjects: ["Economics", "Marketing"], classes: ["SS1", "SS2", "SS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(13) },
  { id: "T15", name: "Mr. Onyeka", subjects: ["Government"], classes: ["SS1", "SS2", "SS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(14) },
  { id: "T16", name: "Mrs. Lawal", subjects: ["Literature"], classes: ["SS1", "SS2", "SS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(0) },
  { id: "T17", name: "Mr. Nwosu", subjects: ["Civic"], classes: ["SS1", "SS2", "SS3"] as SchoolClass[], unavailable: {}, color: getTeacherColor(1) },
];

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
  clearAllSlots(): Promise<void>;

  // Actions (for undo/redo)
  getActions(): Promise<TimetableAction[]>;
  addAction(action: Omit<TimetableAction, "id">): Promise<TimetableAction>;
  clearActions(): Promise<void>;

  // Subject Quotas
  getSubjectQuotas(): Promise<SubjectQuota[]>;
  updateSubjectQuota(subject: string, quota: Partial<SubjectQuota>): Promise<SubjectQuota | undefined>;
  resetSubjectQuotas(): Promise<SubjectQuota[]>;
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
  private subjectQuotas: Map<string, SubjectQuota>;

  constructor() {
    this.teachers = new Map();
    this.timetable = initializeEmptyTimetable();
    this.actions = [];
    this.subjectQuotas = new Map();
    
    // Initialize with sample teachers
    for (const teacher of initialTeachers) {
      this.teachers.set(teacher.id, teacher);
    }
    
    // Initialize with default quotas
    for (const quota of DEFAULT_QUOTAS) {
      this.subjectQuotas.set(quota.subject, { ...quota });
    }
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

  async clearAllSlots(): Promise<void> {
    this.timetable = initializeEmptyTimetable();
  }

  // Subject Quotas
  async getSubjectQuotas(): Promise<SubjectQuota[]> {
    return Array.from(this.subjectQuotas.values());
  }

  async updateSubjectQuota(subject: string, updates: Partial<SubjectQuota>): Promise<SubjectQuota | undefined> {
    const quota = this.subjectQuotas.get(subject);
    if (!quota) return undefined;
    
    const updated = { ...quota, ...updates };
    this.subjectQuotas.set(subject, updated);
    return updated;
  }

  async resetSubjectQuotas(): Promise<SubjectQuota[]> {
    this.subjectQuotas.clear();
    for (const quota of DEFAULT_QUOTAS) {
      this.subjectQuotas.set(quota.subject, { ...quota });
    }
    return Array.from(this.subjectQuotas.values());
  }
}

export const storage = new MemStorage();
