import { type TimetableSlot, type SchoolClass, CLASSES } from "@shared/schema";
import { getSubjectPeriodCounts } from "@/lib/timetable-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BookOpen, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface SubjectTrackerProps {
  timetable: Map<string, TimetableSlot>;
}

export function SubjectTracker({ timetable }: SubjectTrackerProps) {
  const [selectedClass, setSelectedClass] = useState<SchoolClass>("JSS1");

  const subjectCounts = getSubjectPeriodCounts(timetable, selectedClass);

  const totalRequired = subjectCounts.reduce((sum, s) => sum + s.required, 0);
  const totalAllocated = subjectCounts.reduce((sum, s) => sum + s.allocated, 0);
  const overallProgress = totalRequired > 0 ? (totalAllocated / totalRequired) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Subject Allocation</CardTitle>
          </div>
          <Select
            value={selectedClass}
            onValueChange={(v) => setSelectedClass(v as SchoolClass)}
          >
            <SelectTrigger className="w-24" data-testid="select-class-tracker">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLASSES.map((cls) => (
                <SelectItem key={cls} value={cls}>
                  {cls}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Overall Progress</span>
            <span>
              {totalAllocated} / {totalRequired} periods
            </span>
          </div>
          <Progress value={overallProgress} className="h-2" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[200px] px-4 pb-4">
          <div className="space-y-2">
            {subjectCounts.map((item) => {
              const progress =
                item.required > 0 ? (item.allocated / item.required) * 100 : 0;
              const isComplete = item.allocated >= item.required;
              const isOver = item.allocated > item.required;

              return (
                <Tooltip key={item.subject}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">
                            {item.subject}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={isOver ? "destructive" : isComplete ? "default" : "secondary"}
                              className={cn(
                                "text-xs",
                                isComplete && !isOver && "bg-green-500 hover:bg-green-600"
                              )}
                            >
                              {item.allocated}/{item.required}
                            </Badge>
                            {isComplete && !isOver && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            )}
                            {isOver && (
                              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                            )}
                          </div>
                        </div>
                        <Progress
                          value={Math.min(100, progress)}
                          className={cn(
                            "h-1.5",
                            isOver && "[&>div]:bg-destructive",
                            isComplete && !isOver && "[&>div]:bg-green-500"
                          )}
                        />
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {item.subject}: {item.allocated} of {item.required} periods
                      allocated
                    </p>
                    {isOver && (
                      <p className="text-destructive">
                        Exceeded by {item.allocated - item.required} periods
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
