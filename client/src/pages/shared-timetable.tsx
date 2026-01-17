import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import {
  CLASSES,
  DAYS,
  type Day,
  type TimetableSlot,
  type Teacher,
  type SharedTimetable,
  PERIODS_PER_DAY,
} from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Coffee, Download, ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useRef } from "react";
import html2canvas from "html2canvas";

function getSlotKey(day: Day, schoolClass: string, period: number): string {
  return `${day}-${schoolClass}-${period}`;
}

function getPeriodsForDay(day: Day): number[] {
  const maxPeriods = PERIODS_PER_DAY[day];
  return Array.from({ length: maxPeriods }, (_, i) => i + 1);
}

export default function SharedTimetablePage() {
  const params = useParams();
  const shareId = params.shareId as string;
  const [selectedDay, setSelectedDay] = useState<Day>("Monday");
  const [isDownloading, setIsDownloading] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const { data: shared, isLoading, error } = useQuery<SharedTimetable>({
    queryKey: ["/api/shared", shareId],
  });

  const handleDownload = async () => {
    if (!gridRef.current) return;
    
    setIsDownloading(true);
    try {
      const canvas = await html2canvas(gridRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      
      const link = document.createElement("a");
      link.download = `timetable-${selectedDay.toLowerCase()}-${shareId}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (error) {
      console.error("Download error:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading timetable...</p>
        </div>
      </div>
    );
  }

  if (error || !shared) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-semibold mb-2">Timetable Not Found</h2>
            <p className="text-muted-foreground mb-4">
              This shared timetable may have been deleted or the link is invalid.
            </p>
            <Button asChild variant="outline">
              <a href="/">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Go to Home
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const timetable = new Map<string, TimetableSlot>();
  for (const slot of shared.timetableData) {
    const key = getSlotKey(slot.day, slot.schoolClass, slot.period);
    timetable.set(key, slot);
  }

  const teachers = shared.teacherData;
  const getTeacher = (teacherId: string | null): Teacher | undefined =>
    teacherId ? teachers.find((t) => t.id === teacherId) : undefined;

  const maxPeriods = PERIODS_PER_DAY[selectedDay];

  const getPeriodLabel = (period: number): string => {
    const startHour = 8 + Math.floor((period - 1) * 40 / 60);
    const startMin = ((period - 1) * 40) % 60;
    return `${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}`;
  };

  const isBreakAfter = (period: number): boolean => {
    if (period === 4) return true;
    if (selectedDay !== "Friday" && selectedDay !== "Tuesday" && period === 7) return true;
    return false;
  };

  const getSlotForCell = (day: Day, schoolClass: string, period: number): TimetableSlot => {
    const key = `${day}-${schoolClass}-${period}`;
    return timetable.get(key) || {
      day,
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Calendar className="h-6 w-6 text-primary" />
            <div>
              <h1 className="font-semibold">{shared.title || "Shared Timetable"}</h1>
              <p className="text-xs text-muted-foreground">
                Shared on {new Date(shared.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleDownload}
              disabled={isDownloading}
              variant="outline"
              data-testid="button-download-shared"
            >
              {isDownloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Download
            </Button>
            <Button asChild>
              <a href="/">Create Your Own</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Weekly Schedule
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={selectedDay} onValueChange={(v) => setSelectedDay(v as Day)}>
              <TabsList className="grid w-full grid-cols-5 mb-4">
                {DAYS.map((day) => (
                  <TabsTrigger key={day} value={day} data-testid={`tab-${day.toLowerCase()}`}>
                    {day.slice(0, 3)}
                  </TabsTrigger>
                ))}
              </TabsList>

              {DAYS.map((day) => (
                <TabsContent key={day} value={day} className="mt-0">
                  <div ref={day === selectedDay ? gridRef : undefined} className="overflow-x-auto bg-background p-2">
                    <table className="w-full border-collapse min-w-[800px]">
                      <thead>
                        <tr>
                          <th className="p-2 text-left text-sm font-medium text-muted-foreground w-20">
                            Class
                          </th>
                          {getPeriodsForDay(day).map((period) => (
                            <th
                              key={period}
                              className="p-2 text-center text-sm font-medium text-muted-foreground"
                            >
                              <div className="flex flex-col items-center">
                                <span>P{period}</span>
                                <span className="text-xs opacity-70">{getPeriodLabel(period)}</span>
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
                              <td className="p-2">
                                <Badge variant="secondary" className="font-medium">
                                  {schoolClass}
                                </Badge>
                              </td>
                              {getPeriodsForDay(day).map((period) => {
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
                                const isSlash = slot.slotType === "slash";

                                if (slot.status === "empty") {
                                  return (
                                    <td key={period} className="p-1">
                                      <div className="h-14 w-full flex items-center justify-center rounded-md bg-muted/30 border border-dashed border-muted-foreground/20">
                                        <span className="text-xs text-muted-foreground">Empty</span>
                                      </div>
                                    </td>
                                  );
                                }

                                return (
                                  <td
                                    key={period}
                                    colSpan={isDouble ? 2 : 1}
                                    className="p-1"
                                  >
                                    <div
                                      className={cn(
                                        "h-14 w-full rounded-md flex items-center justify-center text-center p-1 border",
                                        isSlash && "bg-gradient-to-r"
                                      )}
                                      style={{
                                        backgroundColor: isSlash
                                          ? undefined
                                          : teacher?.color
                                          ? `${teacher.color}20`
                                          : undefined,
                                        borderColor: teacher?.color || "hsl(var(--border))",
                                        backgroundImage: isSlash
                                          ? `linear-gradient(to right, ${teacher?.color || "#8884d8"}20, ${slashPairTeacher?.color || "#82ca9d"}20)`
                                          : undefined,
                                      }}
                                    >
                                      <div className="flex flex-col items-center min-w-0">
                                        {isSlash ? (
                                          <>
                                            <span className="text-xs font-medium truncate max-w-full">
                                              {slot.subject}/{slot.slashPairSubject}
                                            </span>
                                            <span className="text-xs text-muted-foreground truncate max-w-full">
                                              {teacher?.name?.split(" ")[0]}/{slashPairTeacher?.name?.split(" ")[0]}
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <span className="text-xs font-medium truncate max-w-full">
                                              {slot.subject}
                                              {isDouble && (
                                                <Badge variant="outline" className="ml-1 text-xs py-0 px-1">
                                                  2x
                                                </Badge>
                                              )}
                                            </span>
                                            {teacher && (
                                              <span className="text-xs text-muted-foreground truncate max-w-full">
                                                {teacher.name.split(" ")[0]}
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {isBreakAfter(4) && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                        <Coffee className="h-4 w-4" />
                        <span>Break after Period 4</span>
                      </div>
                    )}
                    {isBreakAfter(7) && day !== "Friday" && day !== "Tuesday" && (
                      <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                        <Coffee className="h-4 w-4" />
                        <span>Break after Period 7</span>
                      </div>
                    )}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
