import { PERIODS_PER_DAY, BREAK_AFTER_P4, BREAK_AFTER_P7, type Day } from "./schema";

export function wouldCrossBreak(day: Day, startPeriod: number): boolean {
  const maxPeriods = PERIODS_PER_DAY[day];
  if (startPeriod >= maxPeriods) return true;
  if (startPeriod === BREAK_AFTER_P4) return true;
  if (day !== "Friday" && day !== "Tuesday" && startPeriod === BREAK_AFTER_P7) return true;
  return false;
}
