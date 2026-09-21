import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { eq, is, SQL } from "drizzle-orm";
import * as schema from "../shared/schema";

// The injected database below is the only database used by these tests.
// The production pool is constructed lazily and never connects.
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";
const { DatabaseStorage } = await import("./storage");
type ProductionDb = typeof import("./db").db;

const tables = [schema.schools, schema.schoolSettings, schema.teachers, schema.subjects,
  schema.subjectQuotas, schema.timetableSlots, schema.timetableActions, schema.savedTimetables, schema.sharedTimetables];
const user = "test-user";
let pg: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let storage: InstanceType<typeof DatabaseStorage>;

before(async () => {
  pg = new PGlite();
  database = drizzle(pg, { schema });
  // Build the fixture's columns directly from the application schema so tests
  // use PostgreSQL constraints/defaults without maintaining another schema.
  const dialect = new PgDialect();
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      let definition = `"${column.name}" ${column.getSQLType()}`;
      if (column.primary) definition += " PRIMARY KEY";
      if (column.notNull) definition += " NOT NULL";
      if (column.default !== undefined) {
        const value = column.default;
        const literal = is(value, SQL) ? dialect.sqlToQuery(value).sql
          : typeof value === "number" || typeof value === "boolean" ? String(value)
          : `'${(typeof value === "string" ? value : JSON.stringify(value)).replaceAll("'", "''")}'`;
        definition += ` DEFAULT ${literal}`;
      }
      return definition;
    });
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
  }
  await pg.exec("CREATE UNIQUE INDEX school_settings_user_school_unique ON school_settings(user_id, school_id)");
});

beforeEach(async () => {
  await pg.exec(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")} RESTART IDENTITY`);
  await database.insert(schema.schools).values([
    { id: "a", userId: user, name: "School A", isActive: 1, createdAt: 1 },
    { id: "b", userId: user, name: "School B", isActive: 0, createdAt: 2 },
  ]);
  await database.insert(schema.schoolSettings).values([{ userId: user, schoolId: "a" }, { userId: user, schoolId: "b" }]);
  storage = new DatabaseStorage(database as unknown as ProductionDb);
  await storage.createSubject(user, schema.insertSubjectSchema.parse({ name: "Math", jss1Quota: 2 }));
  await storage.createTeacher(user, schema.insertTeacherSchema.parse({ name: "Teacher", subjects: ["Math"], classes: ["JSS1"],
    subjectClasses: { Math: ["JSS1"] }, unavailable: {}, color: "#123456" }));
});
after(async () => { await pg?.close(); });

function occupied(subject: string, teacherId: string, extra: Partial<schema.TimetableSlot> = {}): schema.TimetableSlot {
  return schema.timetableSlotSchema.parse({ day: "Friday", period: 6, schoolClass: "JSS1", status: "occupied", subject,
    teacherId, slotType: "single", slashPairSubject: null, slashPairTeacherId: null, ...extra });
}

test("a failed generated insert rolls back the clear and preserves the old grid", async () => {
  const [teacher] = await storage.getTeachers(user);
  await storage.setSlot(user, occupied("Original lesson", teacher.id));
  const before = await database.select().from(schema.timetableSlots);
  await pg.exec("ALTER TABLE timetable_slots ADD CONSTRAINT reject_generated_math CHECK (subject <> 'Math')");
  try {
    await assert.rejects(storage.autoGenerateTimetable(user, false, true));
    assert.deepEqual(await database.select().from(schema.timetableSlots), before);
  } finally {
    await pg.exec("ALTER TABLE timetable_slots DROP CONSTRAINT reject_generated_math");
  }
});

test("a partial quota never clears the existing timetable", async () => {
  const [teacher] = await storage.getTeachers(user);
  await storage.setSlot(user, occupied("Original lesson", teacher.id));
  await storage.updateSubjectQuota(user, "Math", { jss1Quota: 5 });
  const unavailable = Object.fromEntries(schema.DAYS.map((day) => [day,
    Array.from({ length: schema.PERIODS_PER_DAY[day] }, (_, i) => i + 1).filter((period) => day !== "Monday" || period !== 1),
  ])) as schema.Teacher["unavailable"];
  await storage.updateTeacher(user, teacher.id, { unavailable });
  const before = await database.select().from(schema.timetableSlots);
  const result = await storage.autoGenerateTimetable(user, false, true);
  assert.equal(result.success, false);
  assert.match(result.errors.join(" "), /1\/5 periods/);
  assert.deepEqual(await database.select().from(schema.timetableSlots), before);
});

test("generation pins the original school if active school changes before reads", async () => {
  const [teacher] = await storage.getTeachers(user);
  await database.insert(schema.timetableSlots).values({ ...occupied("School B lesson", teacher.id), userId: user, schoolId: "b", isLocked: 0 });
  const beforeB = await database.select().from(schema.timetableSlots).where(eq(schema.timetableSlots.schoolId, "b"));

  // Switch schools at the transaction boundary, after the original school was
  // selected. This reproduces the observable interleaving from another tab.
  const switchedDatabase = new Proxy(database, {
    get(target, property, receiver) {
      if (property === "transaction") return async (...args: Parameters<typeof database.transaction>) => {
        await target.update(schema.schools).set({ isActive: 0 }).where(eq(schema.schools.id, "a"));
        await target.update(schema.schools).set({ isActive: 1 }).where(eq(schema.schools.id, "b"));
        return target.transaction(...args);
      };
      return Reflect.get(target, property, receiver);
    },
  });
  const pinned = new DatabaseStorage(switchedDatabase as unknown as ProductionDb);
  const result = await pinned.autoGenerateTimetable(user, false, true);
  assert.equal(result.success, true, result.errors.join(" "));
  const schoolA = await database.select().from(schema.timetableSlots).where(eq(schema.timetableSlots.schoolId, "a"));
  assert.equal(schoolA.length, 2);
  assert.ok(schoolA.every((slot) => slot.subject === "Math"));
  assert.deepEqual(await database.select().from(schema.timetableSlots).where(eq(schema.timetableSlots.schoolId, "b")), beforeB);
});

test("successful generation preserves fixed activities and clears stale undo actions", async () => {
  const activity = occupied("Assembly", "", { day: "Monday", period: 1, teacherId: null, slotType: "activity", isLocked: true });
  await storage.setSlot(user, activity);
  await storage.addAction(user, { type: "place", timestamp: 1, slot: activity, previousSlot: null });
  const result = await storage.autoGenerateTimetable(user, false, true);
  assert.equal(result.success, true, result.errors.join(" "));
  const rows = await database.select().from(schema.timetableSlots);
  assert.equal(rows.filter((row) => row.subject === "Math").length, 2);
  assert.equal(rows.filter((row) => row.subject === "Assembly" && row.isLocked === 1).length, 1);
  assert.deepEqual(await storage.getActions(user), []);
});

test("ordinary quota edits update both records, including zero values", async () => {
  for (const count of [4, 0]) {
    await storage.updateSubjectQuota(user, "Math", { jss1Quota: count });
    const [subject] = await database.select().from(schema.subjects);
    const [quota] = await database.select().from(schema.subjectQuotas);
    assert.equal(subject.jss1Quota, count);
    assert.equal(quota.jss1Quota, count);
  }
});

test("quota synchronization rolls back if the subject update fails", async () => {
  await pg.exec("ALTER TABLE subjects ADD CONSTRAINT reject_quota_four CHECK (jss1_quota <> 4)");
  try {
    await assert.rejects(storage.updateSubjectQuota(user, "Math", { jss1Quota: 4 }));
    assert.equal((await storage.getSubjectQuotas(user))[0].jss1Quota, 2);
  } finally {
    await pg.exec("ALTER TABLE subjects DROP CONSTRAINT reject_quota_four");
  }
});

test("old quota drift does not reappear when editing a subject", async () => {
  await database.update(schema.subjectQuotas).set({ jss1Quota: 4 });
  const [subject] = await storage.getSubjects(user);
  assert.equal(subject.jss1Quota, 4);
  await storage.updateSubject(user, subject.id, { name: subject.name, jss1Quota: subject.jss1Quota, singleOnly: true });
  assert.equal((await storage.getSubjectQuotas(user))[0].jss1Quota, 4);
});

test("subject renaming preserves teachers, timetable references, saved copies and undo history", async () => {
  const [teacher] = await storage.getTeachers(user);
  const [subject] = await storage.getSubjects(user);
  const lesson = occupied("Math", teacher.id, { slashPairSubject: "Math", slashThirdSubject: "Math" });
  await storage.setSlot(user, lesson);
  const activity = occupied("Math", teacher.id, { day: "Monday", teacherId: null, slotType: "activity", isLocked: true });
  await storage.setSlot(user, activity);
  const saved = await storage.createSavedTimetable(user, "Before rename", [lesson, activity]);
  await storage.addAction(user, { type: "place", timestamp: 1, slot: lesson, previousSlot: lesson });
  await database.insert(schema.teachers).values({ ...teacher, id: "other-school-teacher", userId: user, schoolId: "b" });
  await storage.updateSubject(user, subject.id, { name: "Mathematics" });

  const [updatedTeacher] = await storage.getTeachers(user);
  assert.deepEqual(updatedTeacher.subjects, ["Mathematics"]);
  assert.deepEqual(updatedTeacher.subjectClasses, { Mathematics: ["JSS1"] });
  const updated = await storage.getSlot(user, "Friday", "JSS1", 6);
  assert.deepEqual([updated?.subject, updated?.slashPairSubject, updated?.slashThirdSubject], ["Mathematics", "Mathematics", "Mathematics"]);
  assert.equal((await storage.getSlot(user, "Monday", "JSS1", 6))?.subject, "Math");
  const snapshot = await storage.getSavedTimetable(user, saved.id);
  assert.equal(snapshot?.timetableData[0].subject, "Mathematics");
  assert.equal(snapshot?.timetableData[1].subject, "Math");
  assert.equal((await storage.getActions(user))[0].previousSlot?.subject, "Mathematics");
  const [other] = await database.select().from(schema.teachers).where(eq(schema.teachers.schoolId, "b"));
  assert.deepEqual(other.subjects, ["Math"]);
});

test("renaming a slash member updates the reciprocal group in both classes", async () => {
  const [math] = await storage.getSubjects(user);
  await storage.createSubject(user, schema.insertSubjectSchema.parse({ name: "Physics" }));
  await storage.updateSubject(user, math.id, { ss2SlashPairName: "Physics", ss3SlashPairName: "Physics" });
  await storage.updateSubject(user, math.id, { name: "Mathematics" });
  const subjects = await storage.getSubjects(user);
  for (const cls of ["SS2", "SS3"] as const) {
    assert.deepEqual(schema.findSlashGroup(subjects, "Mathematics", cls).map((s) => s.name).sort(), ["Mathematics", "Physics"]);
  }
});

test("migration backfills legacy groups once and preserves later class edits", async () => {
  const migration = await readFile(new URL("../scripts/migrate-ss2-ss3-slash-groups.sql", import.meta.url), "utf8");
  await database.update(schema.subjects).set({ isSlashSubject: 1, slashPairName: "Physics", slashThirdName: "Chemistry" });
  await pg.exec(migration);
  let [subject] = await database.select().from(schema.subjects);
  assert.equal(subject.ss2SlashPairName, "Physics");
  assert.equal(subject.ss3SlashThirdName, "Chemistry");
  // Disable SS2 and change SS3 to a pair. The legacy fields deliberately still
  // contain a third member to exercise the old COALESCE corruption.
  await database.update(schema.subjects).set({ ss2SlashPairName: null, ss2SlashThirdName: null, ss3SlashThirdName: null });
  const before = await database.select().from(schema.subjects);
  await pg.exec(migration);
  await pg.exec(migration);
  assert.deepEqual(await database.select().from(schema.subjects), before);
});
