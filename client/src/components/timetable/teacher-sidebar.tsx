import { type Teacher, type TimetableSlot, DAYS } from "@shared/schema";
import { calculateTeacherWorkload } from "@/lib/timetable-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Users, ChevronDown, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface TeacherSidebarProps {
  teachers: Teacher[];
  timetable: Map<string, TimetableSlot>;
}

export function TeacherSidebar({ teachers, timetable }: TeacherSidebarProps) {
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);

  const teacherWorkloads = teachers.map((teacher) => ({
    teacher,
    workload: calculateTeacherWorkload(timetable, teacher),
  }));

  const maxPeriods = 45;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Teachers</CardTitle>
          <Badge variant="secondary" className="ml-auto">
            {teachers.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100vh-200px)] px-4 pb-4">
          <div className="space-y-2">
            {teacherWorkloads.map(({ teacher, workload }) => {
              const utilizationPercent = Math.min(
                100,
                (workload.totalPeriods / maxPeriods) * 100
              );
              const hasFatigueWarning =
                workload.consecutivePeriodsWarnings.length > 0;

              return (
                <Collapsible
                  key={teacher.id}
                  open={expandedTeacher === teacher.id}
                  onOpenChange={(open) =>
                    setExpandedTeacher(open ? teacher.id : null)
                  }
                >
                  <CollapsibleTrigger asChild>
                    <button
                      className="w-full p-3 rounded-lg border bg-card hover-elevate text-left transition-colors"
                      data-testid={`teacher-card-${teacher.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: teacher.color }}
                          />
                          <span className="font-medium text-sm truncate">
                            {teacher.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {hasFatigueWarning && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                              </TooltipTrigger>
                              <TooltipContent>
                                High consecutive periods detected
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {workload.totalPeriods}p
                          </Badge>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform",
                              expandedTeacher === teacher.id && "rotate-180"
                            )}
                          />
                        </div>
                      </div>
                      <div className="mt-2">
                        <Progress
                          value={utilizationPercent}
                          className="h-1.5"
                        />
                      </div>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pl-3 pr-1 py-2">
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Subjects
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {teacher.subjects.map((subject) => (
                            <Badge
                              key={subject}
                              variant="secondary"
                              className="text-xs"
                            >
                              {subject}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Classes
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {teacher.classes.map((cls) => (
                            <Badge
                              key={cls}
                              variant="outline"
                              className="text-xs"
                            >
                              {cls}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Daily Load
                        </p>
                        <div className="grid grid-cols-5 gap-1">
                          {DAYS.map((day) => (
                            <Tooltip key={day}>
                              <TooltipTrigger asChild>
                                <div className="text-center p-1 bg-muted/50 rounded text-xs">
                                  <div className="text-[10px] text-muted-foreground">
                                    {day.slice(0, 2)}
                                  </div>
                                  <div className="font-medium">
                                    {workload.periodsByDay[day]}
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                {workload.periodsByDay[day]} periods on {day}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </div>

                      {hasFatigueWarning && (
                        <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
                          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mb-1">
                            <Clock className="h-3 w-3" />
                            <span className="text-xs font-medium">
                              Fatigue Warnings
                            </span>
                          </div>
                          <div className="space-y-1">
                            {workload.consecutivePeriodsWarnings.map(
                              (warning, i) => (
                                <div
                                  key={i}
                                  className="text-xs text-muted-foreground"
                                >
                                  {warning.day}: P{warning.startPeriod}-P
                                  {warning.endPeriod} ({warning.count}{" "}
                                  consecutive)
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}

                      {Object.entries(teacher.unavailable).length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">
                            Unavailable
                          </p>
                          <div className="space-y-1">
                            {Object.entries(teacher.unavailable).map(
                              ([day, periods]) =>
                                periods.length > 0 && (
                                  <div
                                    key={day}
                                    className="text-xs text-destructive"
                                  >
                                    {day}: P{periods.join(", P")}
                                  </div>
                                )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
