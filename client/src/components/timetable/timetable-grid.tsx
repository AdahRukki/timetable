import {
  CLASSES,
  DAYS,
  type Day,
  type TimetableSlot,
  type Teacher,
  PERIODS_PER_DAY,
} from "@shared/schema";
import { getPeriodsForDay } from "@/lib/timetable-utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Calendar, Clock, Coffee, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  const maxPeriods = PERIODS_PER_DAY[selectedDay];

  const getTeacher = (teacherId: string | null): Teacher | undefined =>
    teacherId ? teachers.find((t) => t.id === teacherId) : undefined;

  const getPeriodLabel = (period: number): string => {
    const startHour = 8 + Math.floor((period - 1) * 40 / 60);
    const startMin = ((period - 1) * 40) % 60;
    return `${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}`;
  };

  const getSlotForCell = (day: Day, schoolClass: string, period: number): TimetableSlot => {
    const key = `${day}-${schoolClass}-${period}`;
    const slot = timetable.get(key);
    
    if (slot) {
      return slot;
    }
    
    return {
      day: day as Day,
      period,
      schoolClass: schoolClass as any,
      status: "empty",
      subject: null,
      teacherId: null,
      slotType: null,
      slashPairSubject: null,
      slashPairTeacherId: null,
    };
  };

  const renderCell = (day: Day, schoolClass: string, period: number, skipDoubleCheck: Set<string>) => {
    const slot = getSlotForCell(day, schoolClass, period);
    const teacher = getTeacher(slot.teacherId);
    const slashPairTeacher = getTeacher(slot.slashPairTeacherId);
    
    const prevKey = `${day}-${schoolClass}-${period - 1}`;
    if (skipDoubleCheck.has(prevKey)) {
      return null;
    }
    
    if (slot.slotType === "double" && slot.status === "occupied") {
      skipDoubleCheck.add(`${day}-${schoolClass}-${period}`);
    }

    const isDouble = slot.slotType === "double";

    if (slot.status === "empty") {
      return (
        <td key={period} className="p-1">
          <button
            onClick={() => onCellClick(slot)}
            className="timetable-cell timetable-cell-empty h-14 w-full flex items-center justify-center rounded-md hover-elevate cursor-pointer group"
            data-testid={`cell-empty-${day}-${schoolClass}-${period}`}
          >
            <Plus className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </td>
      );
    }

    const cellStyle = teacher
      ? { backgroundColor: `${teacher.color}15`, borderColor: teacher.color }
      : {};

    return (
      <td key={period} className="p-1" colSpan={isDouble ? 2 : 1}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={() => onCellClick(slot)}
              className={cn(
                "timetable-cell timetable-cell-occupied w-full flex flex-col items-start justify-center rounded-md px-2 py-1 hover-elevate cursor-pointer text-left border-l-4",
                isDouble ? "h-[7.25rem]" : "h-14"
              )}
              style={cellStyle}
              data-testid={`cell-${day}-${schoolClass}-${period}`}
            >
              {slot.slotType === "slash" ? (
                <>
                  <div className="flex items-center gap-1 w-full">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: teacher?.color }}
                    />
                    <span className="text-xs font-medium truncate">{slot.subject}</span>
                  </div>
                  <div className="flex items-center gap-1 w-full">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: slashPairTeacher?.color }}
                    />
                    <span className="text-xs font-medium truncate">{slot.slashPairSubject}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
                    {teacher?.name?.split(" ")[0]} / {slashPairTeacher?.name?.split(" ")[0]}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1 w-full">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: teacher?.color }}
                    />
                    <span className="text-xs font-medium truncate">{slot.subject}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate w-full">
                    {teacher?.name}
                  </div>
                  {isDouble && (
                    <span className="text-[9px] bg-primary/10 text-primary px-1 rounded mt-0.5">
                      Double
                    </span>
                  )}
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-medium">{slot.subject}</p>
              <p className="text-xs text-muted-foreground">{teacher?.name}</p>
              {slot.slotType === "slash" && (
                <>
                  <p className="font-medium mt-1">{slot.slashPairSubject}</p>
                  <p className="text-xs text-muted-foreground">{slashPairTeacher?.name}</p>
                </>
              )}
              {isDouble && (
                <p className="text-xs text-primary">Double Period</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </td>
    );
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

          {DAYS.map((day) => {
            const periods = getPeriodsForDay(day);
            
            return (
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
                          {periods.map((period) => (
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
                        {CLASSES.map((schoolClass) => {
                          const skipDoubleCheck = new Set<string>();
                          
                          return (
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
                              {periods.map((period) => 
                                renderCell(day, schoolClass, period, skipDoubleCheck)
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}
