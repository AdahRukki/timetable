---
name: Autogen doubles chokepoint
description: Where the timetable auto-generator can place double periods, for future scheduling rules.
---

The auto-generator (`server/routes.ts`) places double periods in exactly one place: the
"try double first" branch inside `tryPlace`. Every other call site passes `allowDouble=false`
(rebalance/relocate/repair/fillSpecificSlot), so they can never create doubles.

**Why:** Adding a per-subject scheduling rule that affects doubles (e.g. "single-periods-only")
only needs to gate that one branch plus skip the dedicated doubles pre-pass in `runAttempt`.

**How to apply:** Thread a predicate/set into `tryPlace` and the pre-pass rather than touching
every call site. The required-doubles pre-pass in `runAttempt` is the only intentional
double-placer besides opportunistic doubling in `placeOneSubjectPeriod`.
