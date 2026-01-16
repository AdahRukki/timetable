import {
  CLASSES,
  DAYS,
  type Day,
  type TimetableSlot,
  type Teacher,
  PERIODS_PER_DAY,
  BREAK_AFTER_P4,
  BREAK_AFTER_P7,
} from "@shared/schema";
import { TimetableCell } from "./timetable-cell";
import { getSlotKey, getPeriodsForDay } from "@/lib/timetable-utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Calendar, Clock } from "lucide-react";

interface TimetableGridProps {
  timetable: Map<string, TimetableSlot>;
  teachers: Teacher[];
  selectedDay: Day;
  onDayChange: (day: Day) => void;
  onCellClick: (slot: TimetableSlot) => void;
}

export function TimetableGrid({
  timetable,
  teachers,
  selectedDay,
  onDayChange,
  onCellClick,
}: TimetableGridProps) {
  const periods = getPeriodsForDay(selectedDay);
  const maxPeriods = PERIODS_PER_DAY[selectedDay];

  const getTeacher = (teacherId: string | null) =>
    teacherId ? teachers.find((t) => t.id === teacherId) : undefined;

  const isBreakAfterPeriod = (period: number) => {
    if (selectedDay === "Friday") {
      return period === 3;
    }
    if (period === BREAK_AFTER_P4) return true;
    if (selectedDay !== "Tuesday" && period === BREAK_AFTER_P7) return true;
    return false;
  };

  const getPeriodLabel = (period: number) => {
    const startHour = 8 + Math.floor((period - 1) * 40 / 60);
    const startMin = ((period - 1) * 40) % 60;
    return `${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}`;
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Weekly Timetable</CardTitle>
        </div>
        <Badge variant="outline" className="font-normal">
          {maxPeriods} periods
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs
          value={selectedDay}
          onValueChange={(v) => onDayChange(v as Day)}
          className="w-full"
        >
          <div className="px-4 pb-2">
            <TabsList className="grid w-full grid-cols-5">
              {DAYS.map((day) => (
                <TabsTrigger
                  key={day}
                  value={day}
                  className="text-sm"
                  data-testid={`tab-${day.toLowerCase()}`}
                >
                  {day.slice(0, 3)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {DAYS.map((day) => (
            <TabsContent
              key={day}
              value={day}
              className="mt-0 focus-visible:outline-none focus-visible:ring-0"
            >
              <div className="overflow-x-auto scrollbar-thin">
                <div className="min-w-[800px] px-4 pb-4">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="w-20 p-2 text-left text-xs font-medium text-muted-foreground sticky left-0 bg-card z-10">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Class
                          </div>
                        </th>
                        {getPeriodsForDay(day).map((period) => (
                          <th
                            key={period}
                            className="p-2 text-center min-w-[90px]"
                          >
                            <div className="text-xs font-medium text-foreground">
                              P{period}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {getPeriodLabel(period)}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {CLASSES.map((schoolClass) => (
                        <>
                          <tr key={schoolClass}>
                            <td className="p-2 sticky left-0 bg-card z-10">
                              <Badge
                                variant={
                                  schoolClass.startsWith("SS")
                                    ? "default"
                                    : "secondary"
                                }
                                className="font-medium"
                              >
                                {schoolClass}
                              </Badge>
                            </td>
                            {getPeriodsForDay(day).map((period) => {
                              const slot = timetable.get(
                                getSlotKey(day, schoolClass, period)
                              );
                              if (!slot) return null;

                              const teacher = getTeacher(slot.teacherId);
                              const slashPairTeacher = getTeacher(
                                slot.slashPairTeacherId
                              );

                              const prevSlot = timetable.get(
                                getSlotKey(day, schoolClass, period - 1)
                              );
                              const isSecondOfDouble =
                                prevSlot?.slotType === "double" &&
                                prevSlot.status === "occupied";

                              return (
                                <td
                                  key={period}
                                  className={cn(
                                    "p-1",
                                    isSecondOfDouble && "hidden"
                                  )}
                                  colSpan={
                                    slot.slotType === "double" ? 2 : 1
                                  }
                                >
                                  <TimetableCell
                                    slot={slot}
                                    teacher={teacher}
                                    slashPairTeacher={slashPairTeacher}
                                    onCellClick={() => onCellClick(slot)}
                                    isDouble={slot.slotType === "double"}
                                    isSecondOfDouble={isSecondOfDouble}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                          {isBreakAfterPeriod(
                            getPeriodsForDay(day).find((p) =>
                              isBreakAfterPeriod(p)
                            ) || 0
                          ) &&
                            schoolClass === CLASSES[0] && (
                              <tr key={`break-indicator-${schoolClass}`}>
                                <td
                                  colSpan={getPeriodsForDay(day).length + 1}
                                  className="py-1"
                                >
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <div className="h-px flex-1 bg-border" />
                                    <span>Break</span>
                                    <div className="h-px flex-1 bg-border" />
                                  </div>
                                </td>
                              </tr>
                            )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
