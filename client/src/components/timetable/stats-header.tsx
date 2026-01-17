import { type TimetableSlot, type Teacher, type SchoolClass, DAYS, CLASSES } from "@shared/schema";
import { getPeriodsForDay, getSlotKey, getFreePeriodStats, MAX_FREE_PERIODS_PER_WEEK, MAX_FREE_PERIODS_PER_DAY, TOTAL_PERIODS_PER_WEEK } from "@/lib/timetable-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CalendarDays,
  Users,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Loader2,
  Clock,
} from "lucide-react";

interface StatsHeaderProps {
  timetable: Map<string, TimetableSlot>;
  teachers: Teacher[];
  onAutoGenerate?: () => void;
  isGenerating?: boolean;
}

export function StatsHeader({ timetable, teachers, onAutoGenerate, isGenerating }: StatsHeaderProps) {
  let totalSlots = 0;
  let occupiedSlots = 0;
  let freeSlots = 0;

  for (const day of DAYS) {
    const periods = getPeriodsForDay(day);
    for (const schoolClass of CLASSES) {
      for (const period of periods) {
        const slot = timetable.get(getSlotKey(day, schoolClass, period));
        if (slot) {
          totalSlots++;
          if (slot.status === "occupied") {
            occupiedSlots++;
          } else if (slot.status === "empty") {
            freeSlots++;
          }
        }
      }
    }
  }

  const completionPercent = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0;

  const stats = [
    {
      label: "Completion",
      value: `${completionPercent}%`,
      icon: CheckCircle2,
      color: completionPercent >= 80 ? "text-green-500" : completionPercent >= 50 ? "text-amber-500" : "text-muted-foreground",
    },
    {
      label: "Scheduled",
      value: occupiedSlots.toString(),
      icon: CalendarDays,
      color: "text-primary",
    },
    {
      label: "Free Periods",
      value: freeSlots.toString(),
      icon: AlertTriangle,
      color: freeSlots > 20 ? "text-amber-500" : "text-muted-foreground",
    },
    {
      label: "Teachers",
      value: teachers.length.toString(),
      icon: Users,
      color: "text-primary",
    },
    {
      label: "Total Slots",
      value: totalSlots.toString(),
      icon: BookOpen,
      color: "text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Timetable Overview</h2>
        {onAutoGenerate && (
          <Button
            onClick={onAutoGenerate}
            disabled={isGenerating}
            data-testid="button-auto-generate"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4 mr-2" />
            )}
            Auto-Generate Timetable
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <div className="mt-3">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Free Periods by Class</span>
          <span className="text-xs text-muted-foreground">(max {MAX_FREE_PERIODS_PER_WEEK}/week, {MAX_FREE_PERIODS_PER_DAY}/day)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {CLASSES.map((schoolClass) => {
            const stats = getFreePeriodStats(timetable, schoolClass as SchoolClass);
            const filledCount = TOTAL_PERIODS_PER_WEEK - stats.weeklyTotal;
            const hasIssues = stats.weeklyExceeded || stats.dailyExceededDays.length > 0;
            
            return (
              <Tooltip key={schoolClass}>
                <TooltipTrigger asChild>
                  <Badge 
                    variant={hasIssues ? "destructive" : stats.weeklyTotal > 0 ? "secondary" : "outline"}
                    className="cursor-default"
                    data-testid={`badge-free-periods-${schoolClass.toLowerCase()}`}
                  >
                    {schoolClass}: {filledCount}/{TOTAL_PERIODS_PER_WEEK}
                    {hasIssues && <AlertTriangle className="h-3 w-3 ml-1" />}
                    {stats.weeklyTotal === 0 && <CheckCircle2 className="h-3 w-3 ml-1 text-green-500" />}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-sm">
                    <p className="font-medium">{schoolClass} Periods</p>
                    <p>Filled: {filledCount} / {TOTAL_PERIODS_PER_WEEK}</p>
                    <p>Free: {stats.weeklyTotal} / {MAX_FREE_PERIODS_PER_WEEK} max</p>
                    {stats.weeklyExceeded && (
                      <p className="text-destructive">Exceeds weekly limit!</p>
                    )}
                    {stats.dailyExceededDays.length > 0 && (
                      <p className="text-destructive">
                        Exceeds daily limit on: {stats.dailyExceededDays.join(", ")}
                      </p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </div>
  );
}
