from pathlib import Path

path = Path("client/src/lib/timetable-utils.ts")
text = path.read_text()
old = 'if (wouldExceedFatigueLimit(timetable, teacherId, day, period, slotType === "double", teacherLimit)) {'
new = 'if (wouldExceedFatigueLimit(timetable, teacherId!, day, period, slotType === "double", teacherLimit)) {'
if old not in text:
    raise RuntimeError("Expected fatigue validation call not found")
path.write_text(text.replace(old, new, 1))
print("TypeScript compatibility fix applied")
