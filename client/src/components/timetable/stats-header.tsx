import { type TimetableSlot, type Teacher, DAYS, CLASSES } from "@shared/schema";
import { getPeriodsForDay, getSlotKey } from "@/lib/timetable-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CalendarDays,
  Users,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Loader2,
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
    </div>
  );
}
