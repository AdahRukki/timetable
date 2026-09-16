from pathlib import Path

replacements = {
    "server/storage.ts": [
        ("export interface IStorageexport interface IStorage", "export interface IStorage"),
        ("  async updateSubject(  async updateSubject(", "  async updateSubject("),
        ("  async deleteSubject(  async deleteSubject(", "  async deleteSubject("),
        ("  async getUserSettings(  async getUserSettings(", "  async getUserSettings("),
        ("  // Subjects  // Subjects", "  // Subjects"),
    ],
    "server/routes.ts": [
        ("function countEmpty(function countEmpty(", "function countEmpty("),
        ("  // Fatigue limit check  // Fatigue limit check", "  // Fatigue limit check"),
        ("  // PHASE 2: Build per-class remaining-needed map.  // PHASE 2: Build per-class remaining-needed map.", "  // PHASE 2: Build per-class remaining-needed map."),
    ],
    "client/src/components/timetable/subject-tracker.tsx": [
        ("export function SubjectTrackerexport function SubjectTracker", "export function SubjectTracker"),
    ],
}

for filename, items in replacements.items():
    path = Path(filename)
    text = path.read_text()
    for old, new in items:
        text = text.replace(old, new)
    path.write_text(text)

print("Three-way slash patch cleanup applied")
