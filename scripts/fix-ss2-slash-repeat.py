from pathlib import Path

path = Path("server/routes.ts")
text = path.read_text()

replacements = [
    (
        '    if (slot.slashPairTeacherId === teacherId) return false;\n',
        '    if (slot.slashPairTeacherId === teacherId) return false;\n    if (slot.slashThirdTeacherId === teacherId) return false;\n',
        "third slash teacher clash check",
    ),
    (
        '    if (slot?.status === "occupied" && slot.slashPairSubject === subject) return true;\n',
        '    if (slot?.status === "occupied" && slot.slashPairSubject === subject) return true;\n    if (slot?.status === "occupied" && slot.slashThirdSubject === subject) return true;\n',
        "third slash subject daily check",
    ),
    (
        '      slot.slashThirdTeacherId = chosen[2]?.id ?? null;\n      placed++;\n    }\n  }\n  return placed;\n}\n',
        '      slot.slashThirdTeacherId = chosen[2]?.id ?? null;\n      placed++;\n      // A subject/slash group may occur only once per class per day.\n      break;\n    }\n  }\n  return placed;\n}\n',
        "one slash occurrence per day",
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match for {label}, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text)
print("SS2/SS3 slash daily-repeat fix applied")
