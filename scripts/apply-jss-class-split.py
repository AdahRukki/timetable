from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:120]!r}")
    text = text.replace(old, new, 1)
    p.write_text(text)


# ---------------------------------------------------------------------------
# shared/schema.ts
# ---------------------------------------------------------------------------
replace_once(
    "shared/schema.ts",
    '''export type PreferredPeriods = { jss: number[]; ss1: number[]; ss2ss3: number[] };
export type RequiredDoubles = { jss: number; ss1: number; ss2ss3: number };

const DEFAULT_PREFERRED_PERIODS: PreferredPeriods = { jss: [], ss1: [], ss2ss3: [] };
const DEFAULT_REQUIRED_DOUBLES: RequiredDoubles = { jss: 0, ss1: 0, ss2ss3: 0 };''',
    '''export type PreferredPeriods = {
  jss: number[];
  jss1?: number[];
  jss2?: number[];
  jss3?: number[];
  ss1: number[];
  ss2ss3: number[];
};
export type RequiredDoubles = {
  jss: number;
  jss1?: number;
  jss2?: number;
  jss3?: number;
  ss1: number;
  ss2ss3: number;
};

const DEFAULT_PREFERRED_PERIODS: PreferredPeriods = { jss: [], ss1: [], ss2ss3: [] };
const DEFAULT_REQUIRED_DOUBLES: RequiredDoubles = { jss: 0, ss1: 0, ss2ss3: 0 };''',
)

replace_once(
    "shared/schema.ts",
    '''  jssQuota: integer("jss_quota").notNull(),
  ss1Quota: integer("ss1_quota").notNull(),''',
    '''  jssQuota: integer("jss_quota").notNull(),
  // Per-JSS-class overrides. Null means fall back to the legacy shared JSS quota.
  jss1Quota: integer("jss1_quota"),
  jss2Quota: integer("jss2_quota"),
  jss3Quota: integer("jss3_quota"),
  ss1Quota: integer("ss1_quota").notNull(),''',
)

replace_once(
    "shared/schema.ts",
    '''  jssQuota: integer("jss_quota").notNull().default(0),
  ss1Quota: integer("ss1_quota").notNull().default(0),''',
    '''  jssQuota: integer("jss_quota").notNull().default(0),
  // Per-JSS-class overrides. Null means fall back to the legacy shared JSS quota.
  jss1Quota: integer("jss1_quota"),
  jss2Quota: integer("jss2_quota"),
  jss3Quota: integer("jss3_quota"),
  ss1Quota: integer("ss1_quota").notNull().default(0),''',
)

replace_once(
    "shared/schema.ts",
    '''export const preferredPeriodsSchema = z.object({
  jss: z.array(z.number().int().min(1).max(9)).default([]),
  ss1: z.array(z.number().int().min(1).max(9)).default([]),
  ss2ss3: z.array(z.number().int().min(1).max(9)).default([]),
});

export const requiredDoublesSchema = z.object({
  jss: z.number().int().min(0).max(4).default(0),
  ss1: z.number().int().min(0).max(4).default(0),
  ss2ss3: z.number().int().min(0).max(4).default(0),
});''',
    '''export const preferredPeriodsSchema = z.object({
  // `jss` is kept as a backwards-compatible fallback for older saved subjects.
  jss: z.array(z.number().int().min(1).max(9)).default([]),
  jss1: z.array(z.number().int().min(1).max(9)).optional(),
  jss2: z.array(z.number().int().min(1).max(9)).optional(),
  jss3: z.array(z.number().int().min(1).max(9)).optional(),
  ss1: z.array(z.number().int().min(1).max(9)).default([]),
  ss2ss3: z.array(z.number().int().min(1).max(9)).default([]),
});

export const requiredDoublesSchema = z.object({
  // `jss` is kept as a backwards-compatible fallback for older saved subjects.
  jss: z.number().int().min(0).max(4).default(0),
  jss1: z.number().int().min(0).max(4).optional(),
  jss2: z.number().int().min(0).max(4).optional(),
  jss3: z.number().int().min(0).max(4).optional(),
  ss1: z.number().int().min(0).max(4).default(0),
  ss2ss3: z.number().int().min(0).max(4).default(0),
});''',
)

replace_once(
    "shared/schema.ts",
    '''  jssQuota: z.number().min(0).max(10),
  ss1Quota: z.number().min(0).max(10),''',
    '''  jssQuota: z.number().min(0).max(10),
  jss1Quota: z.number().min(0).max(10).optional(),
  jss2Quota: z.number().min(0).max(10).optional(),
  jss3Quota: z.number().min(0).max(10).optional(),
  ss1Quota: z.number().min(0).max(10),''',
)

replace_once(
    "shared/schema.ts",
    '''  jssQuota: z.number().min(0).max(10).default(0),
  ss1Quota: z.number().min(0).max(10).default(0),''',
    '''  jssQuota: z.number().min(0).max(10).default(0),
  jss1Quota: z.number().min(0).max(10).optional(),
  jss2Quota: z.number().min(0).max(10).optional(),
  jss3Quota: z.number().min(0).max(10).optional(),
  ss1Quota: z.number().min(0).max(10).default(0),''',
)

replace_once(
    "shared/schema.ts",
    '''export function getQuotaForClass(quota: SubjectQuota, schoolClass: SchoolClass): number {
  if (schoolClass.startsWith("JSS")) {
    return quota.jssQuota;
  } else if (schoolClass === "SS1") {
    return quota.ss1Quota;
  } else {
    return quota.ss2ss3Quota;
  }
}''',
    '''export function getQuotaForClass(quota: SubjectQuota, schoolClass: SchoolClass): number {
  if (schoolClass === "JSS1") return quota.jss1Quota ?? quota.jssQuota;
  if (schoolClass === "JSS2") return quota.jss2Quota ?? quota.jssQuota;
  if (schoolClass === "JSS3") return quota.jss3Quota ?? quota.jssQuota;
  if (schoolClass === "SS1") return quota.ss1Quota;
  return quota.ss2ss3Quota;
}''',
)


# ---------------------------------------------------------------------------
# server/storage.ts
# ---------------------------------------------------------------------------
replace_once(
    "server/storage.ts",
    '''    field: "jssQuota" | "ss1Quota" | "ss2ss3Quota",
    value: number,''',
    '''    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota",
    value: number,''',
)

replace_once(
    "server/storage.ts",
    '''      jssQuota: row.jssQuota,
      ss1Quota: row.ss1Quota,''',
    '''      jssQuota: row.jssQuota,
      jss1Quota: row.jss1Quota ?? row.jssQuota,
      jss2Quota: row.jss2Quota ?? row.jssQuota,
      jss3Quota: row.jss3Quota ?? row.jssQuota,
      ss1Quota: row.ss1Quota,''',
)

replace_once(
    "server/storage.ts",
    '''    if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
    if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;''',
    '''    if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
    if (updates.jss1Quota !== undefined) updateValues.jss1Quota = updates.jss1Quota;
    if (updates.jss2Quota !== undefined) updateValues.jss2Quota = updates.jss2Quota;
    if (updates.jss3Quota !== undefined) updateValues.jss3Quota = updates.jss3Quota;
    if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;''',
)

replace_once(
    "server/storage.ts",
    '''      jssQuota: updates.jssQuota ?? existing.jssQuota,
      ss1Quota: updates.ss1Quota ?? existing.ss1Quota,''',
    '''      jssQuota: updates.jssQuota ?? existing.jssQuota,
      jss1Quota: updates.jss1Quota ?? existing.jss1Quota ?? existing.jssQuota,
      jss2Quota: updates.jss2Quota ?? existing.jss2Quota ?? existing.jssQuota,
      jss3Quota: updates.jss3Quota ?? existing.jss3Quota ?? existing.jssQuota,
      ss1Quota: updates.ss1Quota ?? existing.ss1Quota,''',
)

replace_once(
    "server/storage.ts",
    '''    field: "jssQuota" | "ss1Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<{ a: SubjectQuota; b: SubjectQuota } | undefined> {
    const setValues: Partial<Record<"jssQuota" | "ss1Quota" | "ss2ss3Quota", number>> = {''',
    '''    field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota",
    value: number,
  ): Promise<{ a: SubjectQuota; b: SubjectQuota } | undefined> {
    const setValues: Partial<Record<"jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota", number>> = {''',
)

replace_once(
    "server/storage.ts",
    '''        jssQuota: field === "jssQuota" ? value : row.jssQuota,
        ss1Quota: field === "ss1Quota" ? value : row.ss1Quota,''',
    '''        jssQuota: field === "jssQuota" ? value : row.jssQuota,
        jss1Quota: field === "jss1Quota" ? value : (row.jss1Quota ?? row.jssQuota),
        jss2Quota: field === "jss2Quota" ? value : (row.jss2Quota ?? row.jssQuota),
        jss3Quota: field === "jss3Quota" ? value : (row.jss3Quota ?? row.jssQuota),
        ss1Quota: field === "ss1Quota" ? value : row.ss1Quota,''',
)

# getSubjects mapping
replace_once(
    "server/storage.ts",
    '''      name: row.name,
      jssQuota: row.jssQuota,
      ss1Quota: row.ss1Quota,''',
    '''      name: row.name,
      jssQuota: row.jssQuota,
      jss1Quota: row.jss1Quota ?? row.jssQuota,
      jss2Quota: row.jss2Quota ?? row.jssQuota,
      jss3Quota: row.jss3Quota ?? row.jssQuota,
      ss1Quota: row.ss1Quota,''',
)

# getSubject mapping (second occurrence)
replace_once(
    "server/storage.ts",
    '''      name: row.name,
      jssQuota: row.jssQuota,
      ss1Quota: row.ss1Quota,''',
    '''      name: row.name,
      jssQuota: row.jssQuota,
      jss1Quota: row.jss1Quota ?? row.jssQuota,
      jss2Quota: row.jss2Quota ?? row.jssQuota,
      jss3Quota: row.jss3Quota ?? row.jssQuota,
      ss1Quota: row.ss1Quota,''',
)

replace_once(
    "server/storage.ts",
    '''  async createSubject(userId: string, subject: InsertSubject): Promise<Subject> {
    const preferredPeriods = subject.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] };
    const singleOnly = subject.singleOnly ?? false;''',
    '''  async createSubject(userId: string, subject: InsertSubject): Promise<Subject> {
    const preferredPeriods = subject.preferredPeriods ?? { jss: [], ss1: [], ss2ss3: [] };
    const jss1Quota = subject.jss1Quota ?? subject.jssQuota;
    const jss2Quota = subject.jss2Quota ?? subject.jssQuota;
    const jss3Quota = subject.jss3Quota ?? subject.jssQuota;
    const singleOnly = subject.singleOnly ?? false;''',
)

# Insert class-specific fields into both subject table and quota table inserts.
replace_once(
    "server/storage.ts",
    '''        name: subject.name,
        jssQuota: subject.jssQuota,
        ss1Quota: subject.ss1Quota,''',
    '''        name: subject.name,
        jssQuota: subject.jssQuota,
        jss1Quota,
        jss2Quota,
        jss3Quota,
        ss1Quota: subject.ss1Quota,''',
)
replace_once(
    "server/storage.ts",
    '''        subject: subject.name,
        jssQuota: subject.jssQuota,
        ss1Quota: subject.ss1Quota,''',
    '''        subject: subject.name,
        jssQuota: subject.jssQuota,
        jss1Quota,
        jss2Quota,
        jss3Quota,
        ss1Quota: subject.ss1Quota,''',
)
replace_once(
    "server/storage.ts",
    '''        name: subject.name,
        jssQuota: subject.jssQuota,
        ss1Quota: subject.ss1Quota,''',
    '''        name: subject.name,
        jssQuota: subject.jssQuota,
        jss1Quota,
        jss2Quota,
        jss3Quota,
        ss1Quota: subject.ss1Quota,''',
)

# Update subject and mirrored quota values.
replace_once(
    "server/storage.ts",
    '''      if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
      if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;''',
    '''      if (updates.jssQuota !== undefined) updateValues.jssQuota = updates.jssQuota;
      if (updates.jss1Quota !== undefined) updateValues.jss1Quota = updates.jss1Quota;
      if (updates.jss2Quota !== undefined) updateValues.jss2Quota = updates.jss2Quota;
      if (updates.jss3Quota !== undefined) updateValues.jss3Quota = updates.jss3Quota;
      if (updates.ss1Quota !== undefined) updateValues.ss1Quota = updates.ss1Quota;''',
)
replace_once(
    "server/storage.ts",
    '''      if (updates.jssQuota !== undefined) quotaUpdates.jssQuota = updates.jssQuota;
      if (updates.ss1Quota !== undefined) quotaUpdates.ss1Quota = updates.ss1Quota;''',
    '''      if (updates.jssQuota !== undefined) quotaUpdates.jssQuota = updates.jssQuota;
      if (updates.jss1Quota !== undefined) quotaUpdates.jss1Quota = updates.jss1Quota;
      if (updates.jss2Quota !== undefined) quotaUpdates.jss2Quota = updates.jss2Quota;
      if (updates.jss3Quota !== undefined) quotaUpdates.jss3Quota = updates.jss3Quota;
      if (updates.ss1Quota !== undefined) quotaUpdates.ss1Quota = updates.ss1Quota;''',
)
replace_once(
    "server/storage.ts",
    '''        jssQuota: updates.jssQuota ?? existing.jssQuota,
        ss1Quota: updates.ss1Quota ?? existing.ss1Quota,''',
    '''        jssQuota: updates.jssQuota ?? existing.jssQuota,
        jss1Quota: updates.jss1Quota ?? existing.jss1Quota ?? existing.jssQuota,
        jss2Quota: updates.jss2Quota ?? existing.jss2Quota ?? existing.jssQuota,
        jss3Quota: updates.jss3Quota ?? existing.jss3Quota ?? existing.jssQuota,
        ss1Quota: updates.ss1Quota ?? existing.ss1Quota,''',
)


# ---------------------------------------------------------------------------
# server/routes.ts
# ---------------------------------------------------------------------------
replace_once(
    "server/routes.ts",
    '''        field: z.enum(["jssQuota", "ss1Quota", "ss2ss3Quota"]),''',
    '''        field: z.enum(["jssQuota", "jss1Quota", "jss2Quota", "jss3Quota", "ss1Quota", "ss2ss3Quota"]),''',
)
replace_once(
    "server/routes.ts",
    '''        jssQuota: z.number().min(0).max(10).optional(),
        ss1Quota: z.number().min(0).max(10).optional(),''',
    '''        jssQuota: z.number().min(0).max(10).optional(),
        jss1Quota: z.number().min(0).max(10).optional(),
        jss2Quota: z.number().min(0).max(10).optional(),
        jss3Quota: z.number().min(0).max(10).optional(),
        ss1Quota: z.number().min(0).max(10).optional(),''',
)
# partial subject schema has a second jssQuota block
replace_once(
    "server/routes.ts",
    '''        jssQuota: z.number().min(0).max(10).optional(),
        ss1Quota: z.number().min(0).max(10).optional(),''',
    '''        jssQuota: z.number().min(0).max(10).optional(),
        jss1Quota: z.number().min(0).max(10).optional(),
        jss2Quota: z.number().min(0).max(10).optional(),
        jss3Quota: z.number().min(0).max(10).optional(),
        ss1Quota: z.number().min(0).max(10).optional(),''',
)

replace_once(
    "server/routes.ts",
    '''type ClassLevel = "jss" | "ss1" | "ss2ss3";
function classLevel(cls: SchoolClass): ClassLevel {
  if (cls.startsWith("JSS")) return "jss";
  if (cls === "SS1") return "ss1";
  return "ss2ss3";
}
function getPreferredPeriods(quota: SubjectQuota, cls: SchoolClass): number[] {
  return quota.preferredPeriods?.[classLevel(cls)] ?? [];
}
function getRequiredDoubles(quota: SubjectQuota, cls: SchoolClass): number {
  return quota.requiredDoubles?.[classLevel(cls)] ?? 0;
}''',
    '''type ClassLevel = "jss1" | "jss2" | "jss3" | "ss1" | "ss2ss3";
function classLevel(cls: SchoolClass): ClassLevel {
  if (cls === "JSS1") return "jss1";
  if (cls === "JSS2") return "jss2";
  if (cls === "JSS3") return "jss3";
  if (cls === "SS1") return "ss1";
  return "ss2ss3";
}
function getPreferredPeriods(quota: SubjectQuota, cls: SchoolClass): number[] {
  const level = classLevel(cls);
  const specific = quota.preferredPeriods?.[level];
  if (specific !== undefined) return specific;
  if (cls.startsWith("JSS")) return quota.preferredPeriods?.jss ?? [];
  return [];
}
function getRequiredDoubles(quota: SubjectQuota, cls: SchoolClass): number {
  const level = classLevel(cls);
  const specific = quota.requiredDoubles?.[level];
  if (specific !== undefined) return specific;
  if (cls.startsWith("JSS")) return quota.requiredDoubles?.jss ?? 0;
  return 0;
}''',
)


# ---------------------------------------------------------------------------
# client/src/pages/settings.tsx
# ---------------------------------------------------------------------------
replace_once(
    "client/src/pages/settings.tsx",
    '''  const [newSubjectJssQuota, setNewSubjectJssQuota] = useState(4);
  const [newSubjectSs1Quota, setNewSubjectSs1Quota] = useState(4);''',
    '''  const [newSubjectJss1Quota, setNewSubjectJss1Quota] = useState(4);
  const [newSubjectJss2Quota, setNewSubjectJss2Quota] = useState(4);
  const [newSubjectJss3Quota, setNewSubjectJss3Quota] = useState(4);
  const [newSubjectSs1Quota, setNewSubjectSs1Quota] = useState(4);''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''  const [newSubjectPreferredJss, setNewSubjectPreferredJss] = useState<number[]>([]);
  const [newSubjectPreferredSs1, setNewSubjectPreferredSs1] = useState<number[]>([]);''',
    '''  const [newSubjectPreferredJss1, setNewSubjectPreferredJss1] = useState<number[]>([]);
  const [newSubjectPreferredJss2, setNewSubjectPreferredJss2] = useState<number[]>([]);
  const [newSubjectPreferredJss3, setNewSubjectPreferredJss3] = useState<number[]>([]);
  const [newSubjectPreferredSs1, setNewSubjectPreferredSs1] = useState<number[]>([]);''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''  const [newSubjectDoublesJss, setNewSubjectDoublesJss] = useState(0);
  const [newSubjectDoublesSs1, setNewSubjectDoublesSs1] = useState(0);''',
    '''  const [newSubjectDoublesJss1, setNewSubjectDoublesJss1] = useState(0);
  const [newSubjectDoublesJss2, setNewSubjectDoublesJss2] = useState(0);
  const [newSubjectDoublesJss3, setNewSubjectDoublesJss3] = useState(0);
  const [newSubjectDoublesSs1, setNewSubjectDoublesSs1] = useState(0);''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''      field: "jssQuota" | "ss1Quota" | "ss2ss3Quota";''',
    '''      field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2ss3Quota";''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''      jssQuota: number;
      ss1Quota: number;
      ss2ss3Quota: number;
      isSlashSubject: boolean;
      slashPairName: string | null;
      preferredPeriods?: { jss: number[]; ss1: number[]; ss2ss3: number[] };
      requiredDoubles?: { jss: number; ss1: number; ss2ss3: number };''',
    '''      jssQuota: number;
      jss1Quota: number;
      jss2Quota: number;
      jss3Quota: number;
      ss1Quota: number;
      ss2ss3Quota: number;
      isSlashSubject: boolean;
      slashPairName: string | null;
      preferredPeriods?: { jss: number[]; jss1: number[]; jss2: number[]; jss3: number[]; ss1: number[]; ss2ss3: number[] };
      requiredDoubles?: { jss: number; jss1: number; jss2: number; jss3: number; ss1: number; ss2ss3: number };''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''    setNewSubjectJssQuota(4);
    setNewSubjectSs1Quota(4);''',
    '''    setNewSubjectJss1Quota(4);
    setNewSubjectJss2Quota(4);
    setNewSubjectJss3Quota(4);
    setNewSubjectSs1Quota(4);''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''    setNewSubjectPreferredJss([]);
    setNewSubjectPreferredSs1([]);''',
    '''    setNewSubjectPreferredJss1([]);
    setNewSubjectPreferredJss2([]);
    setNewSubjectPreferredJss3([]);
    setNewSubjectPreferredSs1([]);''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''    setNewSubjectDoublesJss(0);
    setNewSubjectDoublesSs1(0);''',
    '''    setNewSubjectDoublesJss1(0);
    setNewSubjectDoublesJss2(0);
    setNewSubjectDoublesJss3(0);
    setNewSubjectDoublesSs1(0);''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''    setNewSubjectJssQuota(subject.jssQuota);
    setNewSubjectSs1Quota(subject.ss1Quota);''',
    '''    setNewSubjectJss1Quota(subject.jss1Quota ?? subject.jssQuota);
    setNewSubjectJss2Quota(subject.jss2Quota ?? subject.jssQuota);
    setNewSubjectJss3Quota(subject.jss3Quota ?? subject.jssQuota);
    setNewSubjectSs1Quota(subject.ss1Quota);''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''    setNewSubjectPreferredJss(subject.preferredPeriods?.jss ?? []);
    setNewSubjectPreferredSs1(subject.preferredPeriods?.ss1 ?? []);''',
    '''    setNewSubjectPreferredJss1(subject.preferredPeriods?.jss1 ?? subject.preferredPeriods?.jss ?? []);
    setNewSubjectPreferredJss2(subject.preferredPeriods?.jss2 ?? subject.preferredPeriods?.jss ?? []);
    setNewSubjectPreferredJss3(subject.preferredPeriods?.jss3 ?? subject.preferredPeriods?.jss ?? []);
    setNewSubjectPreferredSs1(subject.preferredPeriods?.ss1 ?? []);''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''    setNewSubjectDoublesJss(subject.requiredDoubles?.jss ?? 0);
    setNewSubjectDoublesSs1(subject.requiredDoubles?.ss1 ?? 0);''',
    '''    setNewSubjectDoublesJss1(subject.requiredDoubles?.jss1 ?? subject.requiredDoubles?.jss ?? 0);
    setNewSubjectDoublesJss2(subject.requiredDoubles?.jss2 ?? subject.requiredDoubles?.jss ?? 0);
    setNewSubjectDoublesJss3(subject.requiredDoubles?.jss3 ?? subject.requiredDoubles?.jss ?? 0);
    setNewSubjectDoublesSs1(subject.requiredDoubles?.ss1 ?? 0);''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''    const preferredPeriods = {
      jss: [...newSubjectPreferredJss].sort((a, b) => a - b),
      ss1: [...newSubjectPreferredSs1].sort((a, b) => a - b),
      ss2ss3: [...newSubjectPreferredSs2ss3].sort((a, b) => a - b),
    };
    const requiredDoubles = newSubjectSingleOnly
      ? { jss: 0, ss1: 0, ss2ss3: 0 }
      : {
          jss: newSubjectDoublesJss,
          ss1: newSubjectDoublesSs1,
          ss2ss3: newSubjectDoublesSs2ss3,
        };''',
    '''    const preferredPeriods = {
      jss: [...newSubjectPreferredJss1].sort((a, b) => a - b),
      jss1: [...newSubjectPreferredJss1].sort((a, b) => a - b),
      jss2: [...newSubjectPreferredJss2].sort((a, b) => a - b),
      jss3: [...newSubjectPreferredJss3].sort((a, b) => a - b),
      ss1: [...newSubjectPreferredSs1].sort((a, b) => a - b),
      ss2ss3: [...newSubjectPreferredSs2ss3].sort((a, b) => a - b),
    };
    const requiredDoubles = newSubjectSingleOnly
      ? { jss: 0, jss1: 0, jss2: 0, jss3: 0, ss1: 0, ss2ss3: 0 }
      : {
          jss: newSubjectDoublesJss1,
          jss1: newSubjectDoublesJss1,
          jss2: newSubjectDoublesJss2,
          jss3: newSubjectDoublesJss3,
          ss1: newSubjectDoublesSs1,
          ss2ss3: newSubjectDoublesSs2ss3,
        };''',
)

# Both edit and create payloads use the class-specific quota fields.
replace_once(
    "client/src/pages/settings.tsx",
    '''          jssQuota: newSubjectJssQuota,
          ss1Quota: newSubjectSs1Quota,''',
    '''          jssQuota: newSubjectJss1Quota,
          jss1Quota: newSubjectJss1Quota,
          jss2Quota: newSubjectJss2Quota,
          jss3Quota: newSubjectJss3Quota,
          ss1Quota: newSubjectSs1Quota,''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''        jssQuota: newSubjectJssQuota,
        ss1Quota: newSubjectSs1Quota,''',
    '''        jssQuota: newSubjectJss1Quota,
        jss1Quota: newSubjectJss1Quota,
        jss2Quota: newSubjectJss2Quota,
        jss3Quota: newSubjectJss3Quota,
        ss1Quota: newSubjectSs1Quota,''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''  const jssSubjects = quotas.filter(q => q.jssQuota > 0 || (!q.isSlashSubject && q.ss1Quota === 0 && q.ss2ss3Quota === 0));
  const ssSubjects = quotas.filter(q => q.ss1Quota > 0 || q.ss2ss3Quota > 0);

''',
    '''''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''                        <span>JSS: {subject.jssQuota}</span>
                        <span>SS1: {subject.ss1Quota}</span>
                        <span>SS2/SS3: {subject.ss2ss3Quota}</span>
                        <span className="font-medium text-foreground">Total: {(subject.jssQuota * 3) + subject.ss1Quota + (subject.ss2ss3Quota * 2)}</span>''',
    '''                        <span>JSS1: {subject.jss1Quota ?? subject.jssQuota}</span>
                        <span>JSS2: {subject.jss2Quota ?? subject.jssQuota}</span>
                        <span>JSS3: {subject.jss3Quota ?? subject.jssQuota}</span>
                        <span>SS1: {subject.ss1Quota}</span>
                        <span>SS2/SS3: {subject.ss2ss3Quota}</span>
                        <span className="font-medium text-foreground">Total: {(subject.jss1Quota ?? subject.jssQuota) + (subject.jss2Quota ?? subject.jssQuota) + (subject.jss3Quota ?? subject.jssQuota) + subject.ss1Quota + (subject.ss2ss3Quota * 2)}</span>''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jss-quota">JSS Quota</Label>
                  <NumberInput
                    id="jss-quota"
                    min={0}
                    max={10}
                    value={newSubjectJssQuota}
                    onChange={setNewSubjectJssQuota}
                    data-testid="input-jss-quota"
                  />
                  <p className="text-xs text-muted-foreground">× 3 classes = {newSubjectJssQuota * 3}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ss1-quota">SS1 Quota</Label>
                  <NumberInput
                    id="ss1-quota"
                    min={0}
                    max={10}
                    value={newSubjectSs1Quota}
                    onChange={setNewSubjectSs1Quota}
                    data-testid="input-ss1-quota"
                  />
                  <p className="text-xs text-muted-foreground">× 1 class = {newSubjectSs1Quota}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ss2ss3-quota">SS2/SS3 Quota</Label>
                  <NumberInput
                    id="ss2ss3-quota"
                    min={0}
                    max={10}
                    value={newSubjectSs2ss3Quota}
                    onChange={setNewSubjectSs2ss3Quota}
                    data-testid="input-ss2ss3-quota"
                  />
                  <p className="text-xs text-muted-foreground">× 2 classes = {newSubjectSs2ss3Quota * 2}</p>
                </div>
              </div>
              <div className="bg-muted/50 rounded-md p-3 mt-2">
                <p className="text-sm font-medium">
                  Total Weekly Periods: {(newSubjectJssQuota * 3) + newSubjectSs1Quota + (newSubjectSs2ss3Quota * 2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  JSS ({newSubjectJssQuota} × 3) + SS1 ({newSubjectSs1Quota} × 1) + SS2/SS3 ({newSubjectSs2ss3Quota} × 2)
                </p>
              </div>''',
    '''              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {([
                  ["JSS1", "jss1-quota", newSubjectJss1Quota, setNewSubjectJss1Quota],
                  ["JSS2", "jss2-quota", newSubjectJss2Quota, setNewSubjectJss2Quota],
                  ["JSS3", "jss3-quota", newSubjectJss3Quota, setNewSubjectJss3Quota],
                  ["SS1", "ss1-quota", newSubjectSs1Quota, setNewSubjectSs1Quota],
                  ["SS2/SS3", "ss2ss3-quota", newSubjectSs2ss3Quota, setNewSubjectSs2ss3Quota],
                ] as const).map(([label, id, value, setter]) => (
                  <div className="space-y-2" key={id}>
                    <Label htmlFor={id}>{label} Quota</Label>
                    <NumberInput
                      id={id}
                      min={0}
                      max={10}
                      value={value}
                      onChange={setter}
                      data-testid={`input-${id}`}
                    />
                  </div>
                ))}
              </div>
              <div className="bg-muted/50 rounded-md p-3 mt-2">
                <p className="text-sm font-medium">
                  Total Weekly Periods: {newSubjectJss1Quota + newSubjectJss2Quota + newSubjectJss3Quota + newSubjectSs1Quota + (newSubjectSs2ss3Quota * 2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  JSS1 ({newSubjectJss1Quota}) + JSS2 ({newSubjectJss2Quota}) + JSS3 ({newSubjectJss3Quota}) + SS1 ({newSubjectSs1Quota}) + SS2/SS3 ({newSubjectSs2ss3Quota} × 2)
                </p>
              </div>''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''                {(["jss", "ss1", "ss2ss3"] as const).map((lvl) => {
                  const label = lvl === "jss" ? "JSS" : lvl === "ss1" ? "SS1" : "SS2/SS3";
                  const value =
                    lvl === "jss" ? newSubjectPreferredJss
                    : lvl === "ss1" ? newSubjectPreferredSs1
                    : newSubjectPreferredSs2ss3;
                  const setter =
                    lvl === "jss" ? setNewSubjectPreferredJss
                    : lvl === "ss1" ? setNewSubjectPreferredSs1
                    : setNewSubjectPreferredSs2ss3;''',
    '''                {(["jss1", "jss2", "jss3", "ss1", "ss2ss3"] as const).map((lvl) => {
                  const label = lvl === "jss1" ? "JSS1" : lvl === "jss2" ? "JSS2" : lvl === "jss3" ? "JSS3" : lvl === "ss1" ? "SS1" : "SS2/SS3";
                  const value =
                    lvl === "jss1" ? newSubjectPreferredJss1
                    : lvl === "jss2" ? newSubjectPreferredJss2
                    : lvl === "jss3" ? newSubjectPreferredJss3
                    : lvl === "ss1" ? newSubjectPreferredSs1
                    : newSubjectPreferredSs2ss3;
                  const setter =
                    lvl === "jss1" ? setNewSubjectPreferredJss1
                    : lvl === "jss2" ? setNewSubjectPreferredJss2
                    : lvl === "jss3" ? setNewSubjectPreferredJss3
                    : lvl === "ss1" ? setNewSubjectPreferredSs1
                    : setNewSubjectPreferredSs2ss3;''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="doubles-jss" className="text-xs text-muted-foreground">JSS</Label>
                    <NumberInput
                      id="doubles-jss"
                      min={0}
                      max={4}
                      value={newSubjectSingleOnly ? 0 : newSubjectDoublesJss}
                      onChange={setNewSubjectDoublesJss}
                      disabled={newSubjectSingleOnly}
                      data-testid="input-doubles-jss"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="doubles-ss1" className="text-xs text-muted-foreground">SS1</Label>
                    <NumberInput
                      id="doubles-ss1"
                      min={0}
                      max={4}
                      value={newSubjectSingleOnly ? 0 : newSubjectDoublesSs1}
                      onChange={setNewSubjectDoublesSs1}
                      disabled={newSubjectSingleOnly}
                      data-testid="input-doubles-ss1"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="doubles-ss2ss3" className="text-xs text-muted-foreground">SS2/SS3</Label>
                    <NumberInput
                      id="doubles-ss2ss3"
                      min={0}
                      max={4}
                      value={newSubjectSingleOnly ? 0 : newSubjectDoublesSs2ss3}
                      onChange={setNewSubjectDoublesSs2ss3}
                      disabled={newSubjectSingleOnly}
                      data-testid="input-doubles-ss2ss3"
                    />
                  </div>
                </div>''',
    '''                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {([
                    ["JSS1", "doubles-jss1", newSubjectDoublesJss1, setNewSubjectDoublesJss1],
                    ["JSS2", "doubles-jss2", newSubjectDoublesJss2, setNewSubjectDoublesJss2],
                    ["JSS3", "doubles-jss3", newSubjectDoublesJss3, setNewSubjectDoublesJss3],
                    ["SS1", "doubles-ss1", newSubjectDoublesSs1, setNewSubjectDoublesSs1],
                    ["SS2/SS3", "doubles-ss2ss3", newSubjectDoublesSs2ss3, setNewSubjectDoublesSs2ss3],
                  ] as const).map(([label, id, value, setter]) => (
                    <div className="space-y-1" key={id}>
                      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
                      <NumberInput
                        id={id}
                        min={0}
                        max={4}
                        value={newSubjectSingleOnly ? 0 : value}
                        onChange={setter}
                        disabled={newSubjectSingleOnly}
                        data-testid={`input-${id}`}
                      />
                    </div>
                  ))}
                </div>''',
)

# Split summary totals into separate JSS1/JSS2/JSS3 counters.
replace_once(
    "client/src/pages/settings.tsx",
    '''                        const jssTotal = quotas.reduce((sum, q) => sum + q.jssQuota, 0);
                        const ss1Total = quotas.reduce((sum, q) => sum + q.ss1Quota, 0);''',
    '''                        const jss1Total = quotas.reduce((sum, q) => sum + (q.jss1Quota ?? q.jssQuota), 0);
                        const jss2Total = quotas.reduce((sum, q) => sum + (q.jss2Quota ?? q.jssQuota), 0);
                        const jss3Total = quotas.reduce((sum, q) => sum + (q.jss3Quota ?? q.jssQuota), 0);
                        const ss1Total = quotas.reduce((sum, q) => sum + q.ss1Quota, 0);''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''                        const jssInRange = jssTotal >= 37 && jssTotal <= 40;
                        const ss1InRange = ss1Total >= 37 && ss1Total <= 40;''',
    '''                        const jss1InRange = jss1Total >= 37 && jss1Total <= 40;
                        const jss2InRange = jss2Total >= 37 && jss2Total <= 40;
                        const jss3InRange = jss3Total >= 37 && jss3Total <= 40;
                        const ss1InRange = ss1Total >= 37 && ss1Total <= 40;''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''                              <span className={`text-sm ${jssInRange ? 'text-green-600' : jssTotal > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                JSS: {jssTotal}/40
                              </span>
                              <span className={`text-sm ${ss1InRange ? 'text-green-600' : ss1Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>''',
    '''                              <span className={`text-sm ${jss1InRange ? 'text-green-600' : jss1Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                JSS1: {jss1Total}/40
                              </span>
                              <span className={`text-sm ${jss2InRange ? 'text-green-600' : jss2Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                JSS2: {jss2Total}/40
                              </span>
                              <span className={`text-sm ${jss3InRange ? 'text-green-600' : jss3Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                JSS3: {jss3Total}/40
                              </span>
                              <span className={`text-sm ${ss1InRange ? 'text-green-600' : ss1Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">JSS Subjects (JSS1-JSS3)</h3>
                    <Badge variant="secondary">
                      {quotas.reduce((sum, q) => sum + q.jssQuota, 0)} periods/class ({quotas.reduce((sum, q) => sum + q.jssQuota, 0) * 3} total for 3 classes)
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...quotas]
                      .filter((q) => q.jssQuota > 0)
                      .sort((a, b) => a.subject.localeCompare(b.subject))
                      .map((q) => (
                        <QuotaInput
                          key={q.subject}
                          subject={q.subject}
                          value={q.jssQuota}
                          onChange={(v) => handleQuotaChange(q.subject, "jssQuota", v)}
                          isSlash={q.isSlashSubject}
                          sectionTotal={q.jssQuota * 3}
                        />
                      ))}
                  </div>
                </div>

                <Separator />''',
    '''                {([
                  ["JSS1", "jss1Quota"],
                  ["JSS2", "jss2Quota"],
                  ["JSS3", "jss3Quota"],
                ] as const).map(([label, field], index) => {
                  const valueFor = (q: SubjectQuota) => q[field] ?? q.jssQuota;
                  const total = quotas.reduce((sum, q) => sum + valueFor(q), 0);
                  return (
                    <div key={field}>
                      {index > 0 && <Separator className="mb-6" />}
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">{label} Subjects</h3>
                        <Badge variant="secondary">{total} periods/class</Badge>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[...quotas]
                          .filter((q) => valueFor(q) > 0)
                          .sort((a, b) => a.subject.localeCompare(b.subject))
                          .map((q) => (
                            <QuotaInput
                              key={`${field}-${q.subject}`}
                              subject={q.subject}
                              value={valueFor(q)}
                              onChange={(v) => handleQuotaChange(q.subject, field, v)}
                              isSlash={q.isSlashSubject}
                              sectionTotal={valueFor(q)}
                              testIdSuffix={field}
                            />
                          ))}
                      </div>
                    </div>
                  );
                })}

                <Separator />''',
)

replace_once(
    "client/src/pages/settings.tsx",
    '''function QuotaInput({ 
  subject, 
  value, 
  onChange, 
  isSlash,
  sectionTotal
}: { 
  subject: string; 
  value: number; 
  onChange: (value: number) => void;
  isSlash: boolean;
  sectionTotal: number;
}) {''',
    '''function QuotaInput({ 
  subject, 
  value, 
  onChange, 
  isSlash,
  sectionTotal,
  testIdSuffix = "",
}: { 
  subject: string; 
  value: number; 
  onChange: (value: number) => void;
  isSlash: boolean;
  sectionTotal: number;
  testIdSuffix?: string;
}) {''',
)
replace_once(
    "client/src/pages/settings.tsx",
    '''        data-testid={`input-quota-${subject.toLowerCase().replace(/\\s+/g, "-")}`}''',
    '''        data-testid={`input-quota-${testIdSuffix ? `${testIdSuffix}-` : ""}${subject.toLowerCase().replace(/\\s+/g, "-")}`}''',
)


# Migration/backfill helper for deployments that prefer explicit SQL over db:push.
Path("scripts/migrate-jss-class-quotas.sql").write_text('''-- Split the legacy shared JSS quota into independent JSS1/JSS2/JSS3 values.
-- Safe to run repeatedly.
ALTER TABLE subject_quotas ADD COLUMN IF NOT EXISTS jss1_quota integer;
ALTER TABLE subject_quotas ADD COLUMN IF NOT EXISTS jss2_quota integer;
ALTER TABLE subject_quotas ADD COLUMN IF NOT EXISTS jss3_quota integer;

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS jss1_quota integer;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS jss2_quota integer;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS jss3_quota integer;

UPDATE subject_quotas
SET jss1_quota = COALESCE(jss1_quota, jss_quota),
    jss2_quota = COALESCE(jss2_quota, jss_quota),
    jss3_quota = COALESCE(jss3_quota, jss_quota);

UPDATE subjects
SET jss1_quota = COALESCE(jss1_quota, jss_quota),
    jss2_quota = COALESCE(jss2_quota, jss_quota),
    jss3_quota = COALESCE(jss3_quota, jss_quota);
''')

print("JSS class split patch applied")
