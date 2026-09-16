from pathlib import Path
import re

replacements = {
    "server/storage.ts": [
        ("export interface IStorageexport interface IStorage", "export interface IStorage"),
        ("  async updateSubject(  async updateSubject(", "  async updateSubject("),
        ("  async deleteSubject(  async deleteSubject(", "  async deleteSubject("),
        ("  async getUserSettings(  async getUserSettings(", "  async getUserSettings("),
        ("  // Subjects  // Subjects", "  // Subjects"),
        ("const names = [...new Set(rawNames.filter(Boolean))];", "const names = Array.from(new Set(rawNames.filter(Boolean)));"),
        ("const names = [...new Set(subjectNames.filter(Boolean))];", "const names = Array.from(new Set(subjectNames.filter(Boolean)));"),
        ("for (const name of affected) {", "for (const name of Array.from(affected)) {"),
        ("for (const name of touched) {", "for (const name of Array.from(touched)) {"),
    ],
    "server/routes.ts": [
        ("function countEmpty(function countEmpty(", "function countEmpty("),
        ("  // Fatigue limit check  // Fatigue limit check", "  // Fatigue limit check"),
        ("  // PHASE 2: Build per-class remaining-needed map.  // PHASE 2: Build per-class remaining-needed map.", "  // PHASE 2: Build per-class remaining-needed map."),
        (
            "          data.slashPairSubject,\n          data.slashPairTeacherId,\n          isActivity,",
            "          data.slashPairSubject,\n          data.slashPairTeacherId,\n          data.slashThirdSubject,\n          data.slashThirdTeacherId,\n          isActivity,",
        ),
    ],
    "shared/schema.ts": [
        ("const unique = [...new Set(declared)];", "const unique = Array.from(new Set(declared));"),
        ("if ([...new Set(memberDeclared)].sort().join(\"|\") !== expected) return [];", "if (Array.from(new Set(memberDeclared)).sort().join(\"|\") !== expected) return [];"),
    ],
    "client/src/components/timetable/subject-tracker.tsx": [
        ("export function SubjectTrackerexport function SubjectTracker", "export function SubjectTracker"),
    ],
    "client/src/components/timetable/placement-dialog.tsx": [
        (
            "        return getQuotaForClass(s, schoolClass) > 0;",
            "        if (schoolClass === \"JSS1\") return (s.jss1Quota ?? s.jssQuota) > 0;\n        if (schoolClass === \"JSS2\") return (s.jss2Quota ?? s.jssQuota) > 0;\n        if (schoolClass === \"JSS3\") return (s.jss3Quota ?? s.jssQuota) > 0;\n        if (schoolClass === \"SS1\") return s.ss1Quota > 0;\n        return s.ss2ss3Quota > 0;",
        ),
        ("(slashThirdSubject && !slashThirdTeacherId)", "(!!slashThirdSubject && !slashThirdTeacherId)"),
    ],
}

for filename, items in replacements.items():
    path = Path(filename)
    text = path.read_text()
    for old, new in items:
        text = text.replace(old, new)
    path.write_text(text)

# Collapse duplicate generated third-slot properties in storage/home. The first
# patch deliberately touches several similar persistence objects, so cleanup is
# easier and safer here than weakening the source matchers.
for filename in ["server/storage.ts", "client/src/pages/home.tsx"]:
    path = Path(filename)
    text = path.read_text()
    patterns = [
        (r'(?m)^(\s*)slashThirdSubject: slot\.slashThirdSubject,\n\1slashThirdTeacherId: slot\.slashThirdTeacherId,\n\1slashThirdSubject: slot\.slashThirdSubject,\n\1slashThirdTeacherId: slot\.slashThirdTeacherId,\n',
         r'\1slashThirdSubject: slot.slashThirdSubject,\n\1slashThirdTeacherId: slot.slashThirdTeacherId,\n'),
        (r'(?m)^(\s*)slashThirdSubject: slashThirdSubject \|\| null,\n\1slashThirdTeacherId: slashThirdTeacherId \|\| null,\n\1slashThirdSubject: slashThirdSubject \|\| null,\n\1slashThirdTeacherId: slashThirdTeacherId \|\| null,\n',
         r'\1slashThirdSubject: slashThirdSubject || null,\n\1slashThirdTeacherId: slashThirdTeacherId || null,\n'),
        (r'(?m)^(\s*)slashThirdSubject: null,\n\1slashThirdTeacherId: null,\n\1slashThirdSubject: null,\n\1slashThirdTeacherId: null,\n',
         r'\1slashThirdSubject: null,\n\1slashThirdTeacherId: null,\n'),
    ]
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)
    path.write_text(text)

# The settings payload can receive slashThirdName twice because the two legacy
# indentation-specific substitutions overlap. Collapse any adjacent duplicate.
path = Path("client/src/pages/settings.tsx")
text = path.read_text()
text = re.sub(
    r'(?m)^(\s*)slashThirdName: thirdName,\n\1slashThirdName: thirdName,\n',
    r'\1slashThirdName: thirdName,\n',
    text,
)
path.write_text(text)

print("Three-way slash patch cleanup applied")
