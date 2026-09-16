from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing expected block: {label}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    a = text.find(start)
    if a < 0:
        raise RuntimeError(f"Missing start marker: {label}")
    b = text.find(end, a)
    if b < 0:
        raise RuntimeError(f"Missing end marker: {label}")
    return text[:a] + replacement + text[b:]


# ---------------------------------------------------------------------------
# shared/schema.ts
# ---------------------------------------------------------------------------
path = "shared/schema.ts"
text = read(path)

old = '''// Find the partner Subject for a slash subject by name. Returns null when
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
'''
new = '''// Resolve a slash group. Groups may contain two or three subjects. The legacy
// slashPairName remains the first partner; slashThirdName adds an optional
// second partner. Every member must point to the same complete group.
export function findSlashGroup<S extends {
  name: string;
  isSlashSubject: boolean;
  slashPairName: string | null;
  slashThirdName?: string | null;
}>(subjects: S[], subjectName: string): S[] {
  const self = subjects.find((s) => s.name === subjectName);
  if (!self || !self.isSlashSubject || !self.slashPairName) return [];

  const declared = [self.name, self.slashPairName, self.slashThirdName ?? null]
    .filter((name): name is string => !!name);
  const unique = [...new Set(declared)];
  if (unique.length < 2 || unique.length > 3) return [];

  const group = unique
    .map((name) => subjects.find((s) => s.name === name))
    .filter((s): s is S => !!s);
  if (group.length !== unique.length || group.some((s) => !s.isSlashSubject)) return [];

  const expected = [...unique].sort().join("|");
  for (const member of group) {
    const memberDeclared = [member.name, member.slashPairName, member.slashThirdName ?? null]
      .filter((name): name is string => !!name);
    if ([...new Set(memberDeclared)].sort().join("|") !== expected) return [];
  }
  return group;
}

// Backwards-compatible helper for code that only needs the first partner.
export function findSlashPair<S extends {
  name: string;
  isSlashSubject: boolean;
  slashPairName: string | null;
  slashThirdName?: string | null;
}>(subjects: S[], subjectName: string): S | null {
  const group = findSlashGroup(subjects, subjectName);
  return group.find((s) => s.name !== subjectName) ?? null;
}
'''
text = replace_once(text, old, new, "slash group helper")

text = replace_once(
    text,
    '  slashPairSubject: text("slash_pair_subject"),\n  slashPairTeacherId: varchar("slash_pair_teacher_id"),\n',
    '  slashPairSubject: text("slash_pair_subject"),\n  slashPairTeacherId: varchar("slash_pair_teacher_id"),\n  slashThirdSubject: text("slash_third_subject"),\n  slashThirdTeacherId: varchar("slash_third_teacher_id"),\n',
    "timetable third slash columns",
)
text = replace_once(
    text,
    '  slashPairName: text("slash_pair_name"),\n',
    '  slashPairName: text("slash_pair_name"),\n  slashThirdName: text("slash_third_name"),\n',
    "subject third slash column",
)
text = replace_once(
    text,
    '  slashPairSubject: string | null;\n  slashPairTeacherId: string | null;\n  isLocked?: boolean;\n',
    '  slashPairSubject: string | null;\n  slashPairTeacherId: string | null;\n  slashThirdSubject?: string | null;\n  slashThirdTeacherId?: string | null;\n  isLocked?: boolean;\n',
    "saved slot third fields",
)
text = replace_once(
    text,
    '  slashPairSubject: z.string().nullable(),\n  slashPairTeacherId: z.string().nullable(),\n',
    '  slashPairSubject: z.string().nullable(),\n  slashPairTeacherId: z.string().nullable(),\n  slashThirdSubject: z.string().nullable().default(null),\n  slashThirdTeacherId: z.string().nullable().default(null),\n',
    "slot zod third fields",
)
text = replace_once(
    text,
    '    slashPairSubject: z.string().optional(),\n    slashPairTeacherId: z.string().optional(),\n',
    '    slashPairSubject: z.string().optional(),\n    slashPairTeacherId: z.string().optional(),\n    slashThirdSubject: z.string().optional(),\n    slashThirdTeacherId: z.string().optional(),\n',
    "placement third fields",
)
text = replace_once(
    text,
    '      if (data.slashPairSubject || data.slashPairTeacherId) {\n',
    '      if (data.slashPairSubject || data.slashPairTeacherId || data.slashThirdSubject || data.slashThirdTeacherId) {\n',
    "activity slash validation",
)
text = replace_once(
    text,
    '  slashPairName: z.string().nullable().default(null),\n',
    '  slashPairName: z.string().nullable().default(null),\n  slashThirdName: z.string().nullable().default(null),\n',
    "subject zod third name",
)
write(path, text)


# ---------------------------------------------------------------------------
# server/storage.ts
# ---------------------------------------------------------------------------
path = "server/storage.ts"
text = read(path)

helpers = '''// Slash-group helpers — groups may contain two or three subjects and are kept
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

  for (const name of affected) {
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
  const names = [...new Set(rawNames.filter(Boolean))];
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
  for (const name of touched) {
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

'''
text = replace_between(text, "// Slash-pair helpers", "export interface IStorage", helpers + "export interface IStorage", "storage slash helpers")

old = '''  updateSlashPairQuota(
    userId: string,
    subjectA: string,
    subjectB: string,
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<{ a: SubjectQuota; b: SubjectQuota } | undefined>;
'''
new = '''  updateSlashGroupQuota(
    userId: string,
    subjectNames: string[],
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<SubjectQuota[] | undefined>;
  updateSlashPairQuota(
    userId: string,
    subjectA: string,
    subjectB: string,
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<{ a: SubjectQuota; b: SubjectQuota } | undefined>;
'''
text = replace_once(text, old, new, "storage interface slash quota")

# Third-slot persistence fields. These regexes preserve indentation everywhere.
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: null,\n',
    r'\1slashPairTeacherId: null,\n\1slashThirdSubject: null,\n\1slashThirdTeacherId: null,\n',
    text,
)
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: row\.slashPairTeacherId,\n',
    r'\1slashPairTeacherId: row.slashPairTeacherId,\n\1slashThirdSubject: row.slashThirdSubject,\n\1slashThirdTeacherId: row.slashThirdTeacherId,\n',
    text,
)
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: slot\.slashPairTeacherId,\n',
    r'\1slashPairTeacherId: slot.slashPairTeacherId,\n\1slashThirdSubject: slot.slashThirdSubject,\n\1slashThirdTeacherId: slot.slashThirdTeacherId,\n',
    text,
)

# Replace slash quota implementation with a 2-or-3 subject group implementation.
slash_quota_impl = '''  async updateSlashGroupQuota(
    userId: string,
    subjectNames: string[],
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<SubjectQuota[] | undefined> {
    const names = [...new Set(subjectNames.filter(Boolean))];
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
    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<{ a: SubjectQuota; b: SubjectQuota } | undefined> {
    const result = await this.updateSlashGroupQuota(userId, [subjectA, subjectB], field, value);
    return result ? { a: result[0], b: result[1] } : undefined;
  }

'''
text = replace_between(text, "  async updateSlashPairQuota(", "  // Subjects", slash_quota_impl + "  // Subjects", "storage slash quota implementation")

# Subject row mapping gets the optional third partner.
text = text.replace(
    "      slashPairName: row.slashPairName,\n",
    "      slashPairName: row.slashPairName,\n      slashThirdName: row.slashThirdName,\n",
)

create_subject = '''  async createSubject(userId: string, subject: InsertSubject): Promise<Subject> {
    const preferredPeriods = subject.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] };
    const jss1Quota = subject.jss1Quota ?? subject.jssQuota;
    const jss2Quota = subject.jss2Quota ?? subject.jssQuota;
    const jss3Quota = subject.jss3Quota ?? subject.jssQuota;
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

'''
text = replace_between(text, "  async createSubject(", "  async updateSubject(", create_subject + "  async updateSubject(", "storage createSubject")

update_subject = '''  async updateSubject(userId: string, id: number, updates: Partial<InsertSubject>): Promise<Subject | undefined> {
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

'''
text = replace_between(text, "  async updateSubject(", "  async deleteSubject(", update_subject + "  async deleteSubject(", "storage updateSubject")

delete_subject = '''  async deleteSubject(userId: string, id: number): Promise<boolean> {
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

'''
text = replace_between(text, "  async deleteSubject(", "  async getUserSettings(", delete_subject + "  async getUserSettings(", "storage deleteSubject")

# Saved-timetable reload persistence of third slash fields.
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: slot\.slashPairTeacherId,\n',
    r'\1slashPairTeacherId: slot.slashPairTeacherId,\n\1slashThirdSubject: slot.slashThirdSubject,\n\1slashThirdTeacherId: slot.slashThirdTeacherId,\n',
    text,
)

write(path, text)


# ---------------------------------------------------------------------------
# server/routes.ts
# ---------------------------------------------------------------------------
path = "server/routes.ts"
text = read(path)
text = replace_once(text, "  findSlashPair,\n", "  findSlashPair,\n  findSlashGroup,\n", "routes import slash group")

# Anywhere teacher/subject occupancy considers the legacy second half, include
# the optional third half too.
text = text.replace(
    "slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id",
    "slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id || slot.slashThirdTeacherId === teacher.id",
)
text = text.replace(
    "slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId",
    "slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId || slot.slashThirdTeacherId === teacherId",
)
text = text.replace(
    "slot.subject === subject || slot.slashPairSubject === subject",
    "slot.subject === subject || slot.slashPairSubject === subject || slot.slashThirdSubject === subject",
)

# Add third arguments to server placement validation.
text = replace_once(
    text,
    "  slashPairSubject?: string,\n  slashPairTeacherId?: string,\n  // Non-teaching activity",
    "  slashPairSubject?: string,\n  slashPairTeacherId?: string,\n  slashThirdSubject?: string,\n  slashThirdTeacherId?: string,\n  // Non-teaching activity",
    "routes validate signature",
)

slash_validation = '''  // Slash subject validation (two- or three-way groups).
  if (slotType === "slash") {
    const group = findSlashGroup(allSubjects, subject);
    const expectedPartners = group.filter((s) => s.name !== subject).map((s) => s.name);
    const requestedPartners = [slashPairSubject, slashThirdSubject]
      .filter((name): name is string => !!name);

    if (group.length < 2) {
      errors.push({
        code: "INVALID_SLASH",
        message: `${subject} is not configured as a slash group`,
        severity: "error",
      });
    } else if ([...expectedPartners].sort().join("|") !== [...requestedPartners].sort().join("|")) {
      errors.push({
        code: "SLASH_GROUP_MISMATCH",
        message: `${subject} must be scheduled with ${expectedPartners.join(" / ")}`,
        severity: "error",
      });
    }

    const extras = [
      { subject: slashPairSubject, teacherId: slashPairTeacherId },
      { subject: slashThirdSubject, teacherId: slashThirdTeacherId },
    ].filter((item) => !!item.subject);

    for (const extra of extras) {
      if (!extra.teacherId) {
        errors.push({
          code: "MISSING_SLASH_TEACHER",
          message: `Slash subject ${extra.subject} requires a teacher`,
          severity: "error",
        });
        continue;
      }
      if (extra.teacherId === teacherId || extras.some((other) => other !== extra && other.teacherId === extra.teacherId)) {
        errors.push({
          code: "SLASH_TEACHER_DUPLICATE",
          message: "Each slash subject must have a different teacher",
          severity: "error",
        });
        continue;
      }
      const slashTeacher = teachers.find((t) => t.id === extra.teacherId);
      if (!slashTeacher) {
        errors.push({
          code: "SLASH_TEACHER_NOT_FOUND",
          message: `Teacher for ${extra.subject} was not found`,
          severity: "error",
        });
        continue;
      }
      if (!slashTeacher.subjects.includes(extra.subject!)) {
        errors.push({
          code: "SLASH_TEACHER_SUBJECT_MISMATCH",
          message: `${slashTeacher.name} is not assigned to teach ${extra.subject}`,
          severity: "error",
        });
      }
      if (!slashTeacher.classes.includes(schoolClass) || !getTeacherSubjectClasses(slashTeacher, extra.subject!).includes(schoolClass)) {
        errors.push({
          code: "SLASH_TEACHER_CLASS_MISMATCH",
          message: `${slashTeacher.name} is not assigned to teach ${extra.subject} to ${schoolClass}`,
          severity: "error",
        });
      }
      if ((slashTeacher.unavailable[day] || []).includes(period)) {
        errors.push({
          code: "SLASH_TEACHER_UNAVAILABLE",
          message: `${slashTeacher.name} is unavailable during period ${period} on ${day}`,
          severity: "error",
        });
      }
      if (!isTeacherAvailable(timetable, slashTeacher, day, period)) {
        errors.push({
          code: "SLASH_TEACHER_CLASH",
          message: `${slashTeacher.name} is already teaching another class during period ${period}`,
          severity: "error",
        });
      }
      const slashConsecutive = getConsecutiveTeachingCount(timetable, extra.teacherId, day, [period]);
      const slashLimit = effectiveFatigueLimit(slashTeacher, fatigueLimit);
      if (slashConsecutive > slashLimit) {
        errors.push({
          code: "SLASH_TEACHER_FATIGUE",
          message: `${slashTeacher.name} would exceed ${slashLimit} consecutive teaching periods`,
          severity: "error",
        });
      }
    }
  }
  
'''
text = replace_between(text, "  // Slash subject validation\n", "  // Fatigue limit check", slash_validation + "  // Fatigue limit check", "routes slash validation")

# Third subject daily-occurrence check.
old = '''  // For slash subjects, also check the paired subject
  if (slashPairSubject) {
    const dailyPairCount = getTotalSubjectCountForDay(timetable, day, schoolClass, slashPairSubject, []);
    if (dailyPairCount >= 1) {
      errors.push({
        code: "SUBJECT_ALREADY_SCHEDULED",
        message: `${slashPairSubject} is already scheduled for ${schoolClass} on ${day}`,
        severity: "error",
      });
    }
  }
'''
new = '''  // For slash subjects, also check every partner subject.
  for (const partnerSubject of [slashPairSubject, slashThirdSubject].filter((s): s is string => !!s)) {
    const dailyPairCount = getTotalSubjectCountForDay(timetable, day, schoolClass, partnerSubject, []);
    if (dailyPairCount >= 1) {
      errors.push({
        code: "SUBJECT_ALREADY_SCHEDULED",
        message: `${partnerSubject} is already scheduled for ${schoolClass} on ${day}`,
        severity: "error",
      });
    }
  }
'''
text = replace_once(text, old, new, "routes daily slash checks")

# Pass third fields through validate endpoints (two occurrences).
text = text.replace(
    "        data.slashPairSubject,\n        data.slashPairTeacherId,\n        isActivity,",
    "        data.slashPairSubject,\n        data.slashPairTeacherId,\n        data.slashThirdSubject,\n        data.slashThirdTeacherId,\n        isActivity,",
)

text = replace_once(
    text,
    "          slashPairSubject: data.slashPairSubject || null,\n          slashPairTeacherId: data.slashPairTeacherId || null,\n          isLocked,",
    "          slashPairSubject: data.slashPairSubject || null,\n          slashPairTeacherId: data.slashPairTeacherId || null,\n          slashThirdSubject: data.slashThirdSubject || null,\n          slashThirdTeacherId: data.slashThirdTeacherId || null,\n          isLocked,",
    "routes placed slot third fields",
)

# Add a slash-group quota endpoint while preserving the old pair endpoint.
group_route = '''  // Atomically update all members of a 2- or 3-subject slash group.
  app.patch("/api/quotas/slash-group", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const schema = z.object({
        subjects: z.array(z.string().min(1)).min(2).max(3),
        field: z.enum(["jssQuota", "jss1Quota", "jss2Quota", "jss3Quota", "ss1Quota", "ss2ss3Quota"]),
        value: z.number().int().min(0).max(10),
      });
      const { subjects: names, field, value } = schema.parse(req.body);
      if (new Set(names).size !== names.length) {
        res.status(400).json({ error: "Slash group subjects must differ" });
        return;
      }
      const result = await storage.updateSlashGroupQuota(userId, names, field, value);
      if (!result) {
        res.status(404).json({ error: "Slash group subject not found" });
        return;
      }
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid slash-group quota data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update slash-group quota" });
      }
    }
  });

'''
marker = '  // Atomically update both partners of a slash pair to the same quota value.\n'
if marker not in text:
    raise RuntimeError("Missing routes slash-pair marker")
text = text.replace(marker, group_route + marker, 1)

text = replace_once(
    text,
    '        slashPairName: z.string().nullable().optional(),\n',
    '        slashPairName: z.string().nullable().optional(),\n        slashThirdName: z.string().nullable().optional(),\n',
    "routes subject third field",
)

# Generator core occupancy and clearing.
text = re.sub(
    r'(?m)^(\s*)slot\.slashPairTeacherId = null;\n',
    r'\1slot.slashPairTeacherId = null;\n\1slot.slashThirdSubject = null;\n\1slot.slashThirdTeacherId = null;\n',
    text,
)
text = re.sub(
    r'(?m)^(\s*)slot2\.slashPairTeacherId = null;\n',
    r'\1slot2.slashPairTeacherId = null;\n\1slot2.slashThirdSubject = null;\n\1slot2.slashThirdTeacherId = null;\n',
    text,
)
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: null, slashPairTeacherId: null,',
    r'\1slashPairTeacherId: null, slashPairTeacherId: null,',
    text,
)
# Init timetable object has two slash properties on one line.
text = text.replace(
    "            slashPairSubject: null, slashPairTeacherId: null,\n            isLocked: false,",
    "            slashPairSubject: null, slashPairTeacherId: null,\n            slashThirdSubject: null, slashThirdTeacherId: null,\n            isLocked: false,",
)
# All direct slot clearing blocks.
text = re.sub(
    r'(?m)^(\s*)slot\.slashPairSubject = null;\n\1slot\.slashPairTeacherId = null;\n',
    r'\1slot.slashPairSubject = null;\n\1slot.slashPairTeacherId = null;\n\1slot.slashThirdSubject = null;\n\1slot.slashThirdTeacherId = null;\n',
    text,
)
text = re.sub(
    r'(?m)^(\s*)targetSlot\.slashPairSubject = null;\n\1targetSlot\.slashPairTeacherId = null;\n',
    r'\1targetSlot.slashPairSubject = null;\n\1targetSlot.slashPairTeacherId = null;\n\1targetSlot.slashThirdSubject = null;\n\1targetSlot.slashThirdTeacherId = null;\n',
    text,
)
text = re.sub(
    r'(?m)^(\s*)altSlot\.slashPairSubject = null;\n\1altSlot\.slashPairTeacherId = null;\n',
    r'\1altSlot.slashPairSubject = null;\n\1altSlot.slashPairTeacherId = null;\n\1altSlot.slashThirdSubject = null;\n\1altSlot.slashThirdTeacherId = null;\n',
    text,
)

schedule_group = '''function scheduleSlashGroup(
  timetable: Timetable,
  cls: SchoolClass,
  groupSubjects: string[],
  needed: number,
  teachers: Teacher[],
  fatigueLimit: number,
  warnings: string[]
): number {
  if (groupSubjects.length < 2 || groupSubjects.length > 3) return 0;
  const teacherLists = groupSubjects.map((subject) =>
    teachers.filter((t) => teacherCanTeachSubjectToClass(t, subject, cls))
  );
  for (let i = 0; i < groupSubjects.length; i++) {
    if (teacherLists[i].length === 0) {
      warnings.push(`No teacher for slash subject ${groupSubjects[i]} → ${cls}`);
      return 0;
    }
  }

  let placed = 0;
  const pickTeachers = (
    index: number,
    day: Day,
    period: number,
    chosen: Teacher[],
  ): Teacher[] | null => {
    if (index >= teacherLists.length) return chosen;
    for (const teacher of shuffle(teacherLists[index])) {
      if (chosen.some((t) => t.id === teacher.id)) continue;
      if (isTeacherUnavailable(teacher, day, period)) continue;
      if (!isTeacherFreeAt(timetable, teacher.id, day, period)) continue;
      if (wouldExceedFatigue(timetable, teacher.id, day, [period], fatigueLimit, teacher.maxConsecutivePeriods ?? null)) continue;
      const result = pickTeachers(index + 1, day, period, [...chosen, teacher]);
      if (result) return result;
    }
    return null;
  };

  for (const day of shuffle([...DAYS] as Day[])) {
    if (placed >= needed) break;
    if (groupSubjects.some((subject) => subjectAlreadyTodayForClass(timetable, cls, day, subject))) continue;
    const periods = shuffle(Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1));
    for (const period of periods) {
      if (placed >= needed) break;
      const slot = timetable.get(slotKey(day, cls, period));
      if (!slot || slot.status !== "empty") continue;
      const chosen = pickTeachers(0, day, period, []);
      if (!chosen) continue;
      slot.status = "occupied";
      slot.subject = groupSubjects[0];
      slot.teacherId = chosen[0].id;
      slot.slotType = "slash";
      slot.slashPairSubject = groupSubjects[1] ?? null;
      slot.slashPairTeacherId = chosen[1]?.id ?? null;
      slot.slashThirdSubject = groupSubjects[2] ?? null;
      slot.slashThirdTeacherId = chosen[2]?.id ?? null;
      placed++;
    }
  }
  return placed;
}

'''
text = replace_between(text, "function scheduleSlashPair(", "function countEmpty(", schedule_group + "function countEmpty(", "generator slash group function")

# Count third subject/teacher everywhere in generator helpers not covered above.
text = text.replace(
    "    if (slot.slashPairSubject === subject) count++;\n",
    "    if (slot.slashPairSubject === subject) count++;\n    if (slot.slashThirdSubject === subject) count++;\n",
)
text = text.replace(
    "slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId)",
    "slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId || slot.slashThirdTeacherId === teacherId)",
)

phase1 = '''  // PHASE 1: User-defined 2- or 3-subject slash groups (SS2/SS3).
  const seenSlashGroups = new Set<string>();
  for (const subj of subjects) {
    if (!subj.isSlashSubject) continue;
    const group = findSlashGroup(subjects, subj.name);
    if (group.length < 2) continue;
    const names = group.map((s) => s.name).sort();
    const groupKey = names.join("|");
    if (seenSlashGroups.has(groupKey)) continue;
    seenSlashGroups.add(groupKey);

    const groupQuotas = names
      .map((name) => quotas.find((q) => q.subject === name)?.ss2ss3Quota ?? 0);
    const periods = Math.max(...groupQuotas);
    if (periods <= 0) continue;
    if (groupQuotas.some((q) => q !== periods)) {
      warnings.push(`Slash group ${names.join("/")} has mismatched SS2/SS3 quotas; using ${periods}`);
    }

    for (const cls of ["SS2", "SS3"] as SchoolClass[]) {
      const placed = scheduleSlashGroup(
        timetable, cls, names, periods, teachers, fatigueLimit, warnings,
      );
      if (placed < periods) {
        warnings.push(`Attempt ${attemptNumber}: Slash ${names.join("/")} → ${cls}: placed ${placed}/${periods}`);
      }
    }
  }

'''
text = replace_between(text, "  // PHASE 1: User-defined slash subject pairs.\n", "  // PHASE 2: Build per-class remaining-needed map.", phase1 + "  // PHASE 2: Build per-class remaining-needed map.", "generator phase1")

write(path, text)


# ---------------------------------------------------------------------------
# client/src/lib/timetable-utils.ts
# ---------------------------------------------------------------------------
path = "client/src/lib/timetable-utils.ts"
text = read(path)
text = replace_once(text, "  findSlashPair,\n", "  findSlashPair,\n  findSlashGroup,\n", "client utils slash import")
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: null,\n',
    r'\1slashPairTeacherId: null,\n\1slashThirdSubject: null,\n\1slashThirdTeacherId: null,\n',
    text,
)
text = text.replace(
    "slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id",
    "slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id || slot.slashThirdTeacherId === teacher.id",
)
text = text.replace(
    "slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId",
    "slot.teacherId === teacherId || slot.slashPairTeacherId === teacherId || slot.slashThirdTeacherId === teacherId",
)
text = text.replace(
    "slot.subject === subject || slot.slashPairSubject === subject",
    "slot.subject === subject || slot.slashPairSubject === subject || slot.slashThirdSubject === subject",
)

old = '''  // For slash subjects, also check the paired subject
  if (request.slashPairSubject) {
    const dailyPairCount = getTotalSubjectCountForDay(timetable, day, schoolClass, request.slashPairSubject, []);
    if (dailyPairCount >= 1) {
      errors.push({
        code: "SUBJECT_ALREADY_SCHEDULED",
        message: `${request.slashPairSubject} is already scheduled for ${schoolClass} on ${day}`,
        severity: "error",
      });
    }
  }
  
  // Slash subject validation
  if (slotType === "slash") {
    const partner = findSlashPair(subjects, subject);
    if (!partner) {
      errors.push({
        code: "INVALID_SLASH_SUBJECT",
        message: `${subject} is not configured as a slash subject`,
        severity: "error",
      });
    } else {
      if (!request.slashPairSubject || !request.slashPairTeacherId) {
        errors.push({
          code: "MISSING_SLASH_PAIR",
          message: "Slash subjects require both subjects and teachers",
          severity: "error",
        });
      } else if (request.slashPairSubject !== partner.name) {
        errors.push({
          code: "SLASH_PAIR_MISMATCH",
          message: `${subject} is paired with ${partner.name}, not ${request.slashPairSubject}`,
          severity: "error",
        });
      }
    }
  }
'''
new = '''  // For slash subjects, also check every partner subject.
  for (const partnerSubject of [request.slashPairSubject, request.slashThirdSubject].filter((s): s is string => !!s)) {
    const dailyPairCount = getTotalSubjectCountForDay(timetable, day, schoolClass, partnerSubject, []);
    if (dailyPairCount >= 1) {
      errors.push({
        code: "SUBJECT_ALREADY_SCHEDULED",
        message: `${partnerSubject} is already scheduled for ${schoolClass} on ${day}`,
        severity: "error",
      });
    }
  }
  
  // Slash subject validation supports two- and three-way groups.
  if (slotType === "slash") {
    const group = findSlashGroup(subjects, subject);
    const expected = group.filter((s) => s.name !== subject).map((s) => s.name).sort();
    const requested = [request.slashPairSubject, request.slashThirdSubject]
      .filter((s): s is string => !!s)
      .sort();
    if (group.length < 2) {
      errors.push({
        code: "INVALID_SLASH_SUBJECT",
        message: `${subject} is not configured as a slash group`,
        severity: "error",
      });
    } else if (expected.join("|") !== requested.join("|")) {
      errors.push({
        code: "SLASH_GROUP_MISMATCH",
        message: `${subject} must be scheduled with ${expected.join(" / ")}`,
        severity: "error",
      });
    }
    if (!request.slashPairTeacherId || (expected.length === 2 && !request.slashThirdTeacherId)) {
      errors.push({
        code: "MISSING_SLASH_TEACHER",
        message: "Every slash subject requires its own teacher",
        severity: "error",
      });
    }
    const ids = [teacherId, request.slashPairTeacherId, request.slashThirdTeacherId].filter((id): id is string => !!id);
    if (new Set(ids).size !== ids.length) {
      errors.push({
        code: "SLASH_TEACHER_DUPLICATE",
        message: "Each slash subject must have a different teacher",
        severity: "error",
      });
    }
  }
'''
text = replace_once(text, old, new, "client slash validation")
write(path, text)


# ---------------------------------------------------------------------------
# client/src/components/timetable/subject-tracker.tsx
# ---------------------------------------------------------------------------
path = "client/src/components/timetable/subject-tracker.tsx"
text = read(path)
text = replace_once(
    text,
    'import { type TimetableSlot, type SchoolClass, type SubjectQuota, CLASSES, DAYS, PERIODS_PER_DAY } from "@shared/schema";\n',
    'import { type TimetableSlot, type SchoolClass, type SubjectQuota, CLASSES, DAYS, PERIODS_PER_DAY, getQuotaForClass } from "@shared/schema";\n',
    "tracker quota import",
)
text = replace_between(text, "function getQuotaForClass(", "export function SubjectTracker", "export function SubjectTracker", "tracker old resolver")
text = replace_once(
    text,
    '''          if (slot.slashPairSubject) {
            const pairCurrent = counts.get(slot.slashPairSubject) || 0;
            counts.set(slot.slashPairSubject, pairCurrent + 1);
          }
''',
    '''          if (slot.slashPairSubject) {
            const pairCurrent = counts.get(slot.slashPairSubject) || 0;
            counts.set(slot.slashPairSubject, pairCurrent + 1);
          }
          if (slot.slashThirdSubject) {
            const thirdCurrent = counts.get(slot.slashThirdSubject) || 0;
            counts.set(slot.slashThirdSubject, thirdCurrent + 1);
          }
''',
    "tracker third slash",
)
write(path, text)


# ---------------------------------------------------------------------------
# client/src/pages/settings.tsx
# ---------------------------------------------------------------------------
path = "client/src/pages/settings.tsx"
text = read(path)
text = replace_once(text, 'import { findSlashPair, CLASSES } from "@shared/schema";\n', 'import { findSlashPair, findSlashGroup, CLASSES } from "@shared/schema";\n', "settings slash import")
text = replace_once(text, '  const [newSubjectSlashPair, setNewSubjectSlashPair] = useState<string>("");\n', '  const [newSubjectSlashPair, setNewSubjectSlashPair] = useState<string>("");\n  const [newSubjectSlashThird, setNewSubjectSlashThird] = useState<string>("");\n', "settings third state")
text = replace_once(text, '      slashPairName: string | null;\n', '      slashPairName: string | null;\n      slashThirdName: string | null;\n', "settings create type third")

# Replace quota mutation with group mutation.
old = '''  const updateSlashPairQuotaMutation = useMutation({
    mutationFn: async (payload: {
      subjectA: string;
      subjectB: string;
      field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota";
      value: number;
    }) => {
      return apiRequest("PATCH", "/api/quotas/slash-pair", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to update slash pair",
        description: error instanceof Error ? error.message : "Invalid quota value",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
    },
  });
'''
new = '''  const updateSlashGroupQuotaMutation = useMutation({
    mutationFn: async (payload: {
      subjects: string[];
      field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota";
      value: number;
    }) => apiRequest("PATCH", "/api/quotas/slash-group", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to update slash group",
        description: error instanceof Error ? error.message : "Invalid quota value",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
    },
  });
'''
text = replace_once(text, old, new, "settings slash mutation")

text = replace_once(text, '    setNewSubjectSlashPair("");\n', '    setNewSubjectSlashPair("");\n    setNewSubjectSlashThird("");\n', "settings reset third")
text = replace_once(text, '    setNewSubjectSlashPair(subject.slashPairName || "");\n', '    setNewSubjectSlashPair(subject.slashPairName || "");\n    setNewSubjectSlashThird(subject.slashThirdName || "");\n', "settings edit third")
text = replace_once(text, '    const pairName = isSlash && newSubjectSlashPair ? newSubjectSlashPair : null;\n', '    const pairName = isSlash && newSubjectSlashPair ? newSubjectSlashPair : null;\n    const thirdName = isSlash && newSubjectSlashThird ? newSubjectSlashThird : null;\n', "settings submit third")
text = text.replace('          slashPairName: pairName,\n', '          slashPairName: pairName,\n          slashThirdName: thirdName,\n')
text = text.replace('        slashPairName: pairName,\n', '        slashPairName: pairName,\n        slashThirdName: thirdName,\n')

# Slash form UI: replace the single partner block with partner 1 + optional partner 2.
start = '                {newSubjectIsSlash && (\n                  <div className="space-y-2">\n                    <Label htmlFor="subject-slash-pair">Pairs with</Label>'
end = '                )}\n              </div>\n            </div>\n            <DialogFooter>'
a = text.find(start)
b = text.find(end, a)
if a < 0 or b < 0:
    raise RuntimeError("Missing settings slash UI block")
replacement = '''                {newSubjectIsSlash && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="subject-slash-pair">Slash partner 1</Label>
                      <Select
                        value={newSubjectSlashPair}
                        onValueChange={(v) => {
                          setNewSubjectSlashPair(v);
                          if (newSubjectSlashThird === v) setNewSubjectSlashThird("");
                        }}
                      >
                        <SelectTrigger id="subject-slash-pair" data-testid="select-subject-slash-pair">
                          <SelectValue placeholder="Choose the second subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {slashPairCandidates.map((s) => (
                            <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="subject-slash-third">Slash partner 2 (optional)</Label>
                      <Select
                        value={newSubjectSlashThird || "none"}
                        onValueChange={(v) => setNewSubjectSlashThird(v === "none" ? "" : v)}
                      >
                        <SelectTrigger id="subject-slash-third" data-testid="select-subject-slash-third">
                          <SelectValue placeholder="Add a third subject" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No third subject</SelectItem>
                          {slashPairCandidates
                            .filter((s) => s.name !== newSubjectSlashPair)
                            .map((s) => (
                              <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A slash group can contain 2 or 3 subjects. All members are scheduled in the same period with different teachers.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>'''
text = text[:a] + replacement + text[b + len(end):]

# Replace SS2/SS3 slash pair derivation/rendering with slash groups.
old_start = '                    // Derive slash pairs from the user\'s own subjects.\n'
old_end = '                    return (\n                      <>\n'
a = text.find(old_start)
b = text.find(old_end, a)
if a < 0 or b < 0:
    raise RuntimeError("Missing settings SS2 slash derivation")
new_logic = '''                    // Derive 2- or 3-subject slash groups from the user's subjects.
                    const seenGroups = new Set<string>();
                    const allGroups: string[][] = [];
                    const slashNamesForBadge = new Set<string>();
                    for (const s of subjects) {
                      if (!s.isSlashSubject) continue;
                      const group = findSlashGroup(subjects, s.name);
                      if (group.length < 2) continue;
                      const names = group.map((x) => x.name).sort();
                      const key = names.join("|");
                      if (seenGroups.has(key)) continue;
                      seenGroups.add(key);
                      names.forEach((name) => slashNamesForBadge.add(name));
                      allGroups.push(names);
                    }
                    const groups = allGroups.filter((names) =>
                      Math.max(...names.map((name) => quotas.find((q) => q.subject === name)?.ss2ss3Quota ?? 0)) > 0
                    );
                    const slashTotal = groups.reduce((sum, names) =>
                      sum + Math.max(...names.map((name) => quotas.find((q) => q.subject === name)?.ss2ss3Quota ?? 0)), 0
                    );
                    const regularSubjects = [...quotas]
                      .filter((q) => q.ss2ss3Quota > 0 && !slashNamesForBadge.has(q.subject))
                      .sort((a, b) => a.subject.localeCompare(b.subject));
                    const regularTotal = regularSubjects.reduce((sum, q) => sum + q.ss2ss3Quota, 0);
                    const perClass = slashTotal + regularTotal;

                    return (
                      <>
'''
text = text[:a] + new_logic + text[b + len(old_end):]
# Rename labels and replace groups rendering section.
text = text.replace('Slash Subject Pairs (scheduled simultaneously)', 'Slash Subject Groups (scheduled simultaneously)')
text = text.replace('{pairs.length > 0 && (', '{groups.length > 0 && (')
text = text.replace('{pairs.map(({ a, b }) => {', '{groups.map((names) => {')
# Replace inner pair quota setup block.
old_inner = '''                                const qa = quotas.find((q) => q.subject === a);
                                const qb = quotas.find((q) => q.subject === b);
                                // If the two halves disagree (legacy data), show
                                // the larger value so the user can see something
                                // sensible; the next save syncs both atomically.
                                const quota = Math.max(qa?.ss2ss3Quota ?? 0, qb?.ss2ss3Quota ?? 0);
                                return (
                                  <div key={`${a}-${b}`} className="flex items-center gap-2">
                                    <div className="flex-1">
                                      <Label className="text-sm flex items-center gap-1">
                                        {a} / {b}
                                        <Badge variant="outline" className="text-xs ml-1">Slash</Badge>
                                        <span className="text-xs text-muted-foreground ml-1">({quota * 2} total)</span>
                                      </Label>
                                    </div>
                                    <NumberInput
                                      min={0}
                                      max={10}
                                      value={quota}
                                      onChange={(v) => {
                                        updateSlashPairQuotaMutation.mutate({
                                          subjectA: a,
                                          subjectB: b,
                                          field: "ss2ss3Quota",
                                          value: v,
                                        });
                                      }}
                                      className="w-16"
                                      data-testid={`input-quota-slash-${a.toLowerCase()}-${b.toLowerCase()}`}
                                    />
                                    <span className="text-sm text-muted-foreground">per week</span>
                                  </div>
                                );
'''
new_inner = '''                                const quota = Math.max(...names.map((name) => quotas.find((q) => q.subject === name)?.ss2ss3Quota ?? 0));
                                return (
                                  <div key={names.join("-")} className="flex items-center gap-2">
                                    <div className="flex-1">
                                      <Label className="text-sm flex items-center gap-1">
                                        {names.join(" / ")}
                                        <Badge variant="outline" className="text-xs ml-1">Slash</Badge>
                                        <span className="text-xs text-muted-foreground ml-1">({quota * 2} total slots)</span>
                                      </Label>
                                    </div>
                                    <NumberInput
                                      min={0}
                                      max={10}
                                      value={quota}
                                      onChange={(v) => {
                                        updateSlashGroupQuotaMutation.mutate({
                                          subjects: names,
                                          field: "ss2ss3Quota",
                                          value: v,
                                        });
                                      }}
                                      className="w-16"
                                      data-testid={`input-quota-slash-${names.join("-").toLowerCase()}`}
                                    />
                                    <span className="text-sm text-muted-foreground">per week</span>
                                  </div>
                                );
'''
text = replace_once(text, old_inner, new_inner, "settings slash group rendering")
write(path, text)


# ---------------------------------------------------------------------------
# client/src/components/timetable/placement-dialog.tsx
# ---------------------------------------------------------------------------
path = "client/src/components/timetable/placement-dialog.tsx"
text = read(path)
text = replace_once(text, "  findSlashPair,\n", "  findSlashPair,\n  findSlashGroup,\n  getQuotaForClass,\n", "placement imports")
text = replace_once(
    text,
    '''    slashPairSubject: string | undefined,
    slashPairTeacherId: string | undefined,
    options: PlacementSubmitOptions,
''',
    '''    slashPairSubject: string | undefined,
    slashPairTeacherId: string | undefined,
    slashThirdSubject: string | undefined,
    slashThirdTeacherId: string | undefined,
    options: PlacementSubmitOptions,
''',
    "placement onPlace signature",
)
text = replace_once(
    text,
    '''    slashPairSubject?: string,
    slashPairTeacherId?: string,
  ) => void;
''',
    '''    slashPairSubject?: string,
    slashPairTeacherId?: string,
    slashThirdSubject?: string,
    slashThirdTeacherId?: string,
  ) => void;
''',
    "placement validate signature",
)
text = replace_once(text, '  const [slashPairTeacherId, setSlashPairTeacherId] = useState<string>("");\n', '  const [slashPairTeacherId, setSlashPairTeacherId] = useState<string>("");\n  const [slashThirdSubject, setSlashThirdSubject] = useState<string>("");\n  const [slashThirdTeacherId, setSlashThirdTeacherId] = useState<string>("");\n', "placement third states")
text = replace_once(
    text,
    '    () => !!subject && !isActivity && !!findSlashPair(customSubjects, subject),\n',
    '    () => !!subject && !isActivity && findSlashGroup(customSubjects, subject).length >= 2,\n',
    "placement slash detection",
)
# Fix class-specific subject availability while here.
old = '''        if (schoolClass.startsWith("JSS")) {
          return s.jssQuota > 0;
        } else if (schoolClass === "SS1") {
          return s.ss1Quota > 0;
        } else {
          return s.ss2ss3Quota > 0;
        }
'''
text = replace_once(text, old, '        return getQuotaForClass(s, schoolClass) > 0;\n', "placement class quotas")

old = '''  const slashPairInfo = useMemo(() => {
    if (slotType !== "slash" || !subject || isActivity) return null;
    const partner = findSlashPair(customSubjects, subject);
    if (!partner) return null;
    return { pairSubject: partner.name };
  }, [slotType, subject, customSubjects, isActivity]);
'''
new = '''  const slashPairInfo = useMemo(() => {
    if (slotType !== "slash" || !subject || isActivity) return null;
    const group = findSlashGroup(customSubjects, subject);
    if (group.length < 2) return null;
    const partners = group.filter((s) => s.name !== subject).map((s) => s.name);
    return { pairSubject: partners[0], thirdSubject: partners[1] || "" };
  }, [slotType, subject, customSubjects, isActivity]);
'''
text = replace_once(text, old, new, "placement slash group info")
# Add third teacher list after slashPairTeachers.
marker = '''  const slashPairTeachers = useMemo(() => {
    if (!slashPairInfo?.pairSubject) return [];
    return teachers.filter(
      (t) =>
        t.subjects.includes(slashPairInfo.pairSubject!) &&
        t.classes.includes(schoolClass)
    );
  }, [slashPairInfo, teachers, schoolClass]);
'''
addition = marker + '''
  const slashThirdTeachers = useMemo(() => {
    if (!slashPairInfo?.thirdSubject) return [];
    return teachers.filter(
      (t) =>
        t.subjects.includes(slashPairInfo.thirdSubject) &&
        t.classes.includes(schoolClass)
    );
  }, [slashPairInfo, teachers, schoolClass]);
'''
text = replace_once(text, marker, addition, "placement third teacher list")
# Existing occupied/reset/activity effects.
text = replace_once(text, '      setSlashPairTeacherId(slot.slashPairTeacherId || "");\n', '      setSlashPairTeacherId(slot.slashPairTeacherId || "");\n      setSlashThirdSubject(slot.slashThirdSubject || "");\n      setSlashThirdTeacherId(slot.slashThirdTeacherId || "");\n', "placement edit third")
text = text.replace('      setSlashPairTeacherId("");\n', '      setSlashPairTeacherId("");\n      setSlashThirdSubject("");\n      setSlashThirdTeacherId("");\n')
text = replace_once(
    text,
    '''    if (slashPairInfo?.pairSubject) {
      setSlashPairSubject(slashPairInfo.pairSubject);
    }
''',
    '''    if (slashPairInfo?.pairSubject) {
      setSlashPairSubject(slashPairInfo.pairSubject);
      setSlashThirdSubject(slashPairInfo.thirdSubject || "");
    }
''',
    "placement set group subjects",
)
text = replace_once(
    text,
    '''        slotType === "slash" ? slashPairSubject : undefined,
        slotType === "slash" ? slashPairTeacherId : undefined
      );
''',
    '''        slotType === "slash" ? slashPairSubject : undefined,
        slotType === "slash" ? slashPairTeacherId : undefined,
        slotType === "slash" && slashThirdSubject ? slashThirdSubject : undefined,
        slotType === "slash" && slashThirdTeacherId ? slashThirdTeacherId : undefined
      );
''',
    "placement validate call",
)
text = text.replace(
    '[subject, teacherId, slotType, slashPairSubject, slashPairTeacherId, isOccupied, isActivity, onValidate]',
    '[subject, teacherId, slotType, slashPairSubject, slashPairTeacherId, slashThirdSubject, slashThirdTeacherId, isOccupied, isActivity, onValidate]',
)
# onPlace calls: activity gets two extra undefined; real gets third fields.
text = replace_once(
    text,
    '''        undefined,
        undefined,
        { isActivity: true, isLocked: true, applyToAllClasses },
''',
    '''        undefined,
        undefined,
        undefined,
        undefined,
        { isActivity: true, isLocked: true, applyToAllClasses },
''',
    "placement activity args",
)
text = replace_once(
    text,
    '''      slotType === "slash" ? slashPairSubject : undefined,
      slotType === "slash" ? slashPairTeacherId : undefined,
      { isActivity: false, isLocked, applyToAllClasses: false },
''',
    '''      slotType === "slash" ? slashPairSubject : undefined,
      slotType === "slash" ? slashPairTeacherId : undefined,
      slotType === "slash" && slashThirdSubject ? slashThirdSubject : undefined,
      slotType === "slash" && slashThirdTeacherId ? slashThirdTeacherId : undefined,
      { isActivity: false, isLocked, applyToAllClasses: false },
''',
    "placement real args",
)
# Add third-teacher UI after pair select block.
old = '''                  </Select>
                </div>
              )}

              {validation && (
'''
new = '''                  </Select>
                  {slashPairInfo.thirdSubject && (
                    <>
                      <Label className="text-sm text-muted-foreground pt-2">
                        Third Slash Subject: {slashPairInfo.thirdSubject}
                      </Label>
                      <Select
                        value={slashThirdTeacherId}
                        onValueChange={setSlashThirdTeacherId}
                        disabled={isOccupied}
                      >
                        <SelectTrigger data-testid="select-slash-third-teacher">
                          <SelectValue placeholder="Select teacher for third subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {slashThirdTeachers.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                                {t.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
              )}

              {validation && (
'''
text = replace_once(text, old, new, "placement third teacher UI")
text = replace_once(
    text,
    '(slotType === "slash" && (!slashPairSubject || !slashPairTeacherId))\n',
    '(slotType === "slash" && (!slashPairSubject || !slashPairTeacherId || (slashThirdSubject && !slashThirdTeacherId)))\n',
    "placement button disable",
)
write(path, text)


# ---------------------------------------------------------------------------
# client/src/pages/home.tsx
# ---------------------------------------------------------------------------
path = "client/src/pages/home.tsx"
text = read(path)
# handleValidate signature/call
text = replace_once(
    text,
    '''      slashPairSubject?: string,
      slashPairTeacherId?: string
    ) => {
''',
    '''      slashPairSubject?: string,
      slashPairTeacherId?: string,
      slashThirdSubject?: string,
      slashThirdTeacherId?: string
    ) => {
''',
    "home validate signature",
)
text = replace_once(
    text,
    '''        slashPairSubject,
        slashPairTeacherId,
      }, fatigueLimit, customSubjects);
''',
    '''        slashPairSubject,
        slashPairTeacherId,
        slashThirdSubject,
        slashThirdTeacherId,
      }, fatigueLimit, customSubjects);
''',
    "home validate request",
)
# handlePlace signature
text = replace_once(
    text,
    '''      slashPairSubject: string | undefined,
      slashPairTeacherId: string | undefined,
      options: { isActivity: boolean; isLocked: boolean; applyToAllClasses: boolean },
''',
    '''      slashPairSubject: string | undefined,
      slashPairTeacherId: string | undefined,
      slashThirdSubject: string | undefined,
      slashThirdTeacherId: string | undefined,
      options: { isActivity: boolean; isLocked: boolean; applyToAllClasses: boolean },
''',
    "home place signature",
)
text = text.replace(
    "            slashPairTeacherId: slashPairTeacherId || null,\n",
    "            slashPairTeacherId: slashPairTeacherId || null,\n            slashThirdSubject: slashThirdSubject || null,\n            slashThirdTeacherId: slashThirdTeacherId || null,\n",
)
text = text.replace(
    "        slashPairTeacherId,\n      }, fatigueLimit, customSubjects);",
    "        slashPairTeacherId,\n        slashThirdSubject,\n        slashThirdTeacherId,\n      }, fatigueLimit, customSubjects);",
)
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: slashPairTeacherId \|\| null,\n',
    r'\1slashPairTeacherId: slashPairTeacherId || null,\n\1slashThirdSubject: slashThirdSubject || null,\n\1slashThirdTeacherId: slashThirdTeacherId || null,\n',
    text,
)
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: null,\n',
    r'\1slashPairTeacherId: null,\n\1slashThirdSubject: null,\n\1slashThirdTeacherId: null,\n',
    text,
)
write(path, text)


# ---------------------------------------------------------------------------
# timetable-grid.tsx
# ---------------------------------------------------------------------------
path = "client/src/components/timetable/timetable-grid.tsx"
text = read(path)
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: null,\n',
    r'\1slashPairTeacherId: null,\n\1slashThirdSubject: null,\n\1slashThirdTeacherId: null,\n',
    text,
)
text = replace_once(text, '    const slashPairTeacher = getTeacher(slot.slashPairTeacherId);\n', '    const slashPairTeacher = getTeacher(slot.slashPairTeacherId);\n    const slashThirdTeacher = getTeacher(slot.slashThirdTeacherId);\n', "grid third teacher")
old = '''                  <div className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
                    {teacher?.name?.split(" ")[0]} / {slashPairTeacher?.name?.split(" ")[0]}
                  </div>
'''
new = '''                  {slot.slashThirdSubject && (
                    <div className="flex items-center gap-1 w-full">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: slashThirdTeacher?.color }} />
                      <span className="text-xs font-medium truncate">{slot.slashThirdSubject}</span>
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
                    {[teacher?.name?.split(" ")[0], slashPairTeacher?.name?.split(" ")[0], slashThirdTeacher?.name?.split(" ")[0]].filter(Boolean).join(" / ")}
                  </div>
'''
text = replace_once(text, old, new, "grid third row")
old = '''                  <p className="font-medium mt-1">{slot.slashPairSubject}</p>
                  <p className="text-xs text-muted-foreground">{slashPairTeacher?.name}</p>
'''
new = '''                  <p className="font-medium mt-1">{slot.slashPairSubject}</p>
                  <p className="text-xs text-muted-foreground">{slashPairTeacher?.name}</p>
                  {slot.slashThirdSubject && (
                    <>
                      <p className="font-medium mt-1">{slot.slashThirdSubject}</p>
                      <p className="text-xs text-muted-foreground">{slashThirdTeacher?.name}</p>
                    </>
                  )}
'''
text = replace_once(text, old, new, "grid tooltip third")
write(path, text)


# ---------------------------------------------------------------------------
# timetable-cell.tsx (kept consistent even if the grid currently renders inline)
# ---------------------------------------------------------------------------
path = "client/src/components/timetable/timetable-cell.tsx"
text = read(path)
text = replace_once(text, '  slashPairTeacher?: Teacher;\n', '  slashPairTeacher?: Teacher;\n  slashThirdTeacher?: Teacher;\n', "cell prop third")
text = replace_once(text, '  slashPairTeacher,\n  onCellClick,\n', '  slashPairTeacher,\n  slashThirdTeacher,\n  onCellClick,\n', "cell destructure third")
old = '''          <div className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
            {teacher?.name?.split(" ")[1]} / {slashPairTeacher?.name?.split(" ")[1]}
          </div>
'''
new = '''          {slot.slashThirdSubject && (
            <div className="flex items-center gap-1 w-full">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: slashThirdTeacher?.color }} />
              <span className="text-xs font-medium truncate">{slot.slashThirdSubject}</span>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
            {[teacher?.name?.split(" ")[1], slashPairTeacher?.name?.split(" ")[1], slashThirdTeacher?.name?.split(" ")[1]].filter(Boolean).join(" / ")}
          </div>
'''
text = replace_once(text, old, new, "cell third row")
old = '''              <p className="font-medium mt-1">{slot.slashPairSubject}</p>
              <p className="text-xs text-muted-foreground">{slashPairTeacher?.name}</p>
'''
new = '''              <p className="font-medium mt-1">{slot.slashPairSubject}</p>
              <p className="text-xs text-muted-foreground">{slashPairTeacher?.name}</p>
              {slot.slashThirdSubject && (
                <>
                  <p className="font-medium mt-1">{slot.slashThirdSubject}</p>
                  <p className="text-xs text-muted-foreground">{slashThirdTeacher?.name}</p>
                </>
              )}
'''
text = replace_once(text, old, new, "cell tooltip third")
write(path, text)


# ---------------------------------------------------------------------------
# stats-header.tsx exports/workload
# ---------------------------------------------------------------------------
path = "client/src/components/timetable/stats-header.tsx"
text = read(path)
old = '''                const slashTeacher = teachers.find(t => t.id === slot.slashPairTeacherId);
                row.push(`${slot.subject || ""}\\n(${teacherName})\\n/\\n${slot.slashPairSubject || ""}\\n(${slashTeacher?.name || ""})`);
'''
new = '''                const slashTeacher = teachers.find(t => t.id === slot.slashPairTeacherId);
                const slashThirdTeacher = teachers.find(t => t.id === slot.slashThirdTeacherId);
                const parts = [
                  `${slot.subject || ""}\\n(${teacherName})`,
                  `${slot.slashPairSubject || ""}\\n(${slashTeacher?.name || ""})`,
                ];
                if (slot.slashThirdSubject) parts.push(`${slot.slashThirdSubject}\\n(${slashThirdTeacher?.name || ""})`);
                row.push(parts.join("\\n/\\n"));
'''
text = replace_once(text, old, new, "stats PDF third slash")
text = text.replace(
    "slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id",
    "slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id || slot.slashThirdTeacherId === teacher.id",
)
write(path, text)


# ---------------------------------------------------------------------------
# shared-timetable.tsx
# ---------------------------------------------------------------------------
path = "client/src/pages/shared-timetable.tsx"
text = read(path)
text = re.sub(
    r'(?m)^(\s*)slashPairTeacherId: null,\n',
    r'\1slashPairTeacherId: null,\n\1slashThirdSubject: null,\n\1slashThirdTeacherId: null,\n',
    text,
)
text = replace_once(text, '                                const slashPairTeacher = getTeacher(slot.slashPairTeacherId);\n', '                                const slashPairTeacher = getTeacher(slot.slashPairTeacherId);\n                                const slashThirdTeacher = getTeacher(slot.slashThirdTeacherId);\n', "shared third teacher")
text = replace_once(
    text,
    '{slot.subject}/{slot.slashPairSubject}\n',
    '{[slot.subject, slot.slashPairSubject, slot.slashThirdSubject].filter(Boolean).join("/")}\n',
    "shared subjects third",
)
text = replace_once(
    text,
    '{teacher?.name?.split(" ")[0]}/{slashPairTeacher?.name?.split(" ")[0]}\n',
    '{[teacher?.name?.split(" ")[0], slashPairTeacher?.name?.split(" ")[0], slashThirdTeacher?.name?.split(" ")[0]].filter(Boolean).join("/")}\n',
    "shared teachers third",
)
write(path, text)

print("Three-way slash patch applied")
