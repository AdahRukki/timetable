import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLASSES, DAYS, PERIODS_PER_DAY, findSlashGroup, subjectSchema, subjectQuotaSchema,
  teacherSchema, timetableSlotSchema, userSettingsSchema,
  type SchoolClass, type Subject, type SubjectQuota, type Teacher, type TimetableSlot,
} from "../shared/schema";
import { generateTimetable, validateGeneratedTimetable, type GenerationInput } from "./timetable-generator";

function subject(name: string, overrides: Partial<Subject> = {}): Subject {
  return subjectSchema.parse({ id: name.charCodeAt(0), name, ...overrides });
}
function quota(name: string, overrides: Partial<SubjectQuota> = {}): SubjectQuota {
  return subjectQuotaSchema.parse({ subject: name, jssQuota: 0, ss1Quota: 0, ss2ss3Quota: 0, ...overrides });
}
function teacher(id: string, names: string[], classes: SchoolClass[], overrides: Partial<Teacher> = {}): Teacher {
  return teacherSchema.parse({ id, name: id, subjects: names, classes, color: "#123456", unavailable: {}, ...overrides });
}
function slot(overrides: Partial<TimetableSlot>): TimetableSlot {
  return timetableSlotSchema.parse({ day: "Monday", period: 1, schoolClass: "JSS1", status: "occupied",
    subject: "Math", teacherId: "T", slotType: "single", slashPairSubject: null, slashPairTeacherId: null, ...overrides });
}
function timetable(slots: TimetableSlot[]): Map<string, TimetableSlot> {
  return new Map(slots.map((s) => [`${s.day}-${s.schoolClass}-${s.period}`, s]));
}
function input(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return { subjects: [subject("Math")], quotas: [quota("Math", { jss1Quota: 2 })],
    teachers: [teacher("T", ["Math"], ["JSS1"])], userSettings: userSettingsSchema.parse({}),
    existingTimetable: new Map(), ...overrides };
}
function count(slots: TimetableSlot[], name: string, cls: SchoolClass): number {
  return slots.filter((s) => s.schoolClass === cls && s.slotType !== "activity" &&
    [s.subject, s.slashPairSubject, s.slashThirdSubject].includes(name)).length;
}
function success(data: GenerationInput, keep = false, clear = true): TimetableSlot[] {
  const plan = generateTimetable(data, keep, clear);
  assert.equal(plan.result.success, true, plan.result.errors.join("\n"));
  assert.ok(plan.slots);
  // The standalone validation also covers teacher clashes, fatigue, group
  // membership, and broken double blocks in every successful fixture.
  assert.deepEqual(validateGeneratedTimetable(timetable(plan.slots), data.teachers, data.quotas, data.subjects, data.userSettings), []);
  return plan.slots;
}
function slashSubjects(): Subject[] {
  return [subject("A", { isSlashSubject: true, slashPairName: "B", ss2SlashPairName: "B" }),
    subject("B", { isSlashSubject: true, slashPairName: "A", ss2SlashPairName: "A" })];
}
function onlyAvailable(day: typeof DAYS[number], periods: number[]): Teacher["unavailable"] {
  return Object.fromEntries(DAYS.map((d) => [d, Array.from({ length: PERIODS_PER_DAY[d] }, (_, i) => i + 1)
    .filter((p) => d !== day || !periods.includes(p))])) as Teacher["unavailable"];
}

for (const needed of [6, 10]) {
  test(`fills all ${needed} periods when the teacher is free all week`, () => {
    const slots = success(input({ quotas: [quota("Math", { jss1Quota: needed })] }));
    assert.equal(count(slots, "Math", "JSS1"), needed);
    if (needed === 10) assert.equal(slots.filter((s) => s.slotType === "double").length, 10);
  });
}

for (const doubles of [1, 2]) {
  test(`places ${doubles} required doubles before optional singles`, () => {
    const slots = success(input({ quotas: [quota("Math", { jss1Quota: doubles * 2,
      requiredDoubles: { jss: 0, ss1: 0, ss2ss3: 0, jss1: doubles } })] }));
    assert.equal(slots.length, doubles * 2);
    assert.ok(slots.every((s) => s.slotType === "double"));
  });
}

test("uses a double when a teacher can only teach on one day", () => {
  const slots = success(input({ teachers: [teacher("T", ["Math"], ["JSS1"], { unavailable: onlyAvailable("Monday", [1, 2]) })] }));
  assert.deepEqual(slots.map((s) => [s.day, s.period, s.slotType]), [["Monday", 1, "double"], ["Monday", 2, "double"]]);
});

test("counts preserved doubles toward the required number", () => {
  const existing = [slot({ period: 1, slotType: "double", isLocked: true }), slot({ period: 2, slotType: "double", isLocked: true })];
  const slots = success(input({ existingTimetable: timetable(existing), quotas: [quota("Math", { jss1Quota: 4,
    requiredDoubles: { jss: 0, ss1: 0, ss2ss3: 0, jss1: 2 } })] }), true, false);
  assert.equal(slots.length, 4);
  for (const preserved of existing) assert.deepEqual(timetable(slots).get(`Monday-JSS1-${preserved.period}`), preserved);
});

for (const cls of ["JSS1", "SS1"] as const) {
  test(`senior slash groups stay independent in ${cls}`, () => {
    const subjects = slashSubjects();
    assert.deepEqual(findSlashGroup(subjects, "A", cls), []);
    const quotas = ["A", "B"].map((name) => quota(name, cls === "JSS1" ? { jss1Quota: 2 } : { ss1Quota: 2 }));
    const slots = success(input({ subjects, quotas, teachers: [teacher("T", ["A", "B"], [cls])] }));
    assert.equal(count(slots, "A", cls), 2);
    assert.equal(count(slots, "B", cls), 2);
    assert.ok(slots.every((s) => s.slotType !== "slash"));
  });
}

test("SS2 and SS3 use different slash partners", () => {
  const subjects = slashSubjects();
  subjects[0].ss3SlashPairName = "C";
  subjects.push(subject("C", { isSlashSubject: true, slashPairName: "A", ss3SlashPairName: "A" }));
  const quotas = [quota("A", { ss2Quota: 3, ss3Quota: 2 }), quota("B", { ss2Quota: 3 }), quota("C", { ss3Quota: 2 })];
  const slots = success(input({ subjects, quotas, teachers: ["A", "B", "C"].map((name) => teacher(name, [name], ["SS2", "SS3"])) }));
  assert.equal(slots.length, 5);
  for (const s of slots) assert.equal(s.slashPairSubject, s.schoolClass === "SS2" ? "B" : "C");
});

test("preserved slash lessons are not scheduled a second time", () => {
  const existing = ["Monday", "Tuesday", "Wednesday"].map((day) => slot({ day: day as TimetableSlot["day"],
    schoolClass: "SS2", subject: "A", teacherId: "A", slotType: "slash", slashPairSubject: "B", slashPairTeacherId: "B", isLocked: true }));
  const data = input({ subjects: slashSubjects(), quotas: ["A", "B"].map((n) => quota(n, { ss2Quota: 3 })),
    teachers: ["A", "B"].map((n) => teacher(n, [n], ["SS2"])), existingTimetable: timetable(existing) });
  for (const clear of [true, false]) {
    const slots = success(data, true, clear);
    assert.equal(slots.length, 3);
    assert.deepEqual(timetable(slots), timetable(existing));
  }
});

test("supports complete three-way slash groups", () => {
  const names = ["A", "B", "C"];
  const subjects = names.map((name) => {
    const partners = names.filter((n) => n !== name);
    return subject(name, { isSlashSubject: true, ss2SlashPairName: partners[0], ss2SlashThirdName: partners[1] });
  });
  const slots = success(input({ subjects, quotas: names.map((n) => quota(n, { ss2Quota: 3 })),
    teachers: names.map((n) => teacher(n, [n], ["SS2"])) }));
  assert.equal(slots.length, 3);
  assert.ok(slots.every((s) => new Set([s.teacherId, s.slashPairTeacherId, s.slashThirdTeacherId]).size === 3));
});

for (const partnerQuota of [0, 2]) {
  test(`rejects mismatched slash quotas, including ${partnerQuota} periods`, () => {
    const plan = generateTimetable(input({ subjects: slashSubjects(),
      quotas: [quota("A", { ss2Quota: 3 }), quota("B", { ss2Quota: partnerQuota })],
      teachers: ["A", "B"].map((n) => teacher(n, [n], ["SS2"])) }));
    assert.equal(plan.result.success, false);
    assert.equal(plan.slots, undefined);
    assert.match(plan.result.errors.join(" "), /different quotas/);
  });
}

test("rejects a partial quota and leaves the input unchanged", () => {
  const data = input({ quotas: [quota("Math", { jss1Quota: 5, singleOnly: true })],
    teachers: [teacher("T", ["Math"], ["JSS1"], { unavailable: onlyAvailable("Monday", [1]) })],
    existingTimetable: timetable([slot({ day: "Friday", period: 6 })]) });
  const before = structuredClone(data);
  const plan = generateTimetable(data);
  assert.equal(plan.result.success, false);
  assert.match(plan.result.errors.join(" "), /Math has 1\/5 periods/);
  assert.equal(plan.slots, undefined);
  assert.deepEqual(data, before);
});

test("does not count an activity with the same name as a teaching period", () => {
  const activity = slot({ subject: "Math", teacherId: null, slotType: "activity", isLocked: true });
  const slots = success(input({ existingTimetable: timetable([activity]) }));
  assert.equal(count(slots, "Math", "JSS1"), 2);
  assert.deepEqual(timetable(slots).get("Monday-JSS1-1"), activity);
});

test("preserves singles and warns about an unmet double request", () => {
  const original = slot({ isLocked: true });
  const data = input({ existingTimetable: timetable([original]), quotas: [quota("Math", { jss1Quota: 2,
    requiredDoubles: { jss: 0, ss1: 0, ss2ss3: 0, jss1: 1 } })] });
  const plan = generateTimetable(data, true, false);
  assert.equal(plan.result.success, true, plan.result.errors.join(" "));
  assert.match(plan.result.warnings.join(" "), /0\/1 requested double blocks/);
  assert.equal(plan.slots?.length, 2);
  assert.equal(original.slotType, "single");
});

test("rejects preserved lessons above quota", () => {
  const existing = [slot({ isLocked: true }), slot({ day: "Tuesday", isLocked: true }), slot({ day: "Wednesday", isLocked: true })];
  const plan = generateTimetable(input({ existingTimetable: timetable(existing), quotas: [quota("Math", { jss1Quota: 2 })] }));
  assert.equal(plan.result.success, false);
  assert.match(plan.result.errors.join(" "), /over quota/);
});

test("a zero quota disables a subject despite older double preferences", () => {
  const slots = success(input({ subjects: [subject("Math"), subject("Science")],
    quotas: [quota("Math", { jss1Quota: 2 }), quota("Science", { requiredDoubles: { jss: 1, ss1: 0, ss2ss3: 0 } })] }));
  assert.equal(slots.length, 2);
  assert.ok(slots.every((s) => s.subject === "Math"));
});

test("saves two of five periods with a clear shortfall warning", () => {
  const data = input({ quotas: [quota("Math", { jss1Quota: 5 })],
    teachers: [teacher("T", ["Math"], ["JSS1"], { unavailable: onlyAvailable("Monday", [1, 2]) })] });
  const plan = generateTimetable(data);
  assert.equal(plan.result.success, true, plan.result.errors.join(" "));
  assert.equal(plan.slots?.length, 2);
  assert.match(plan.result.warnings.join(" "), /Math has 2\/5 periods; 3 period\(s\) remain unfilled/);
});

test("zero periods and one period both block saving", () => {
  for (const available of [[], [1]]) {
    const plan = generateTimetable(input({ teachers: [teacher("T", ["Math"], ["JSS1"], {
      unavailable: onlyAvailable("Monday", available),
    })] }));
    assert.equal(plan.result.success, false);
    assert.match(plan.result.errors.join(" "), /At least 2 periods are required/);
    assert.equal(plan.slots, undefined);
  }
});

test("a quota of one requires an explicit correction instead of silently exceeding it", () => {
  const plan = generateTimetable(input({ quotas: [quota("Math", { jss1Quota: 1 })] }));
  assert.equal(plan.result.success, false);
  assert.match(plan.result.errors.join(" "), /Set it to at least 2 periods, or 0/);
});

test("unreachable single-only quotas are warnings above the two-period minimum", () => {
  const plan = generateTimetable(input({ quotas: [quota("Math", { jss1Quota: 6, singleOnly: true,
    requiredDoubles: { jss: 0, ss1: 0, ss2ss3: 0, jss1: 1 } })] }));
  assert.equal(plan.result.success, true, plan.result.errors.join(" "));
  assert.equal(plan.slots?.length, 5);
  assert.match(plan.result.warnings.join(" "), /5\/6 periods/);
  assert.match(plan.result.warnings.join(" "), /0\/1 requested double blocks/);
});

test("the minimum applies separately to every subject and class", () => {
  const data = input({ quotas: [quota("Math", { jss1Quota: 2, ss1Quota: 2 })],
    teachers: [teacher("T", ["Math"], ["JSS1"]), teacher("SS", ["Math"], ["SS1"], { unavailable: onlyAvailable("Monday", [1]) })] });
  const plan = generateTimetable(data);
  assert.equal(plan.result.success, false);
  assert.match(plan.result.errors.join(" "), /SS1: Math has 1\/2 periods/);
});

test("respects disabled doubles and single-only settings", () => {
  for (const singleOnly of [false, true]) {
    const data = input({ quotas: [quota("Math", { jss1Quota: 5, singleOnly })],
      userSettings: userSettingsSchema.parse({ allowDoublePeriods: singleOnly }) });
    const slots = success(data);
    assert.equal(slots.length, 5);
    assert.ok(slots.every((s) => s.slotType === "single"));
  }
});

test("rejects doubles across breaks or in disabled P8/P9", () => {
  for (const periods of [[4, 5], [8, 9]]) {
    const data = input({ teachers: [teacher("T", ["Math"], ["JSS1"], { unavailable: onlyAvailable("Monday", periods) })],
      quotas: [quota("Math", { jss1Quota: 2, requiredDoubles: { jss: 0, ss1: 0, ss2ss3: 0, jss1: 1 } })],
      userSettings: userSettingsSchema.parse({ allowDoubleInP8P9: false }) });
    assert.equal(generateTimetable(data).result.success, false);
  }
});

test("one teacher can cover multiple classes without clashes", () => {
  const data = input({ quotas: [quota("Math", { jssQuota: 4, ss1Quota: 4, ss2Quota: 4, ss3Quota: 4 })],
    teachers: [teacher("T", ["Math"], [...CLASSES], { maxConsecutivePeriods: 3 })] });
  const slots = success(data);
  assert.equal(slots.length, 24);
  assert.equal(new Set(slots.map((s) => `${s.day}:${s.period}:${s.teacherId}`)).size, 24);
});
