import { type TimetableSlot, type Teacher, type SchoolClass, type Day, DAYS, CLASSES } from "@shared/schema";
import { getPeriodsForDay, getSlotKey, getFreePeriodStats, MAX_FREE_PERIODS_PER_WEEK, MAX_FREE_PERIODS_PER_DAY, TOTAL_PERIODS_PER_WEEK } from "@/lib/timetable-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  CalendarDays,
  Users,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Loader2,
  Clock,
  Download,
  Share2,
  Copy,
  Check,
  FileText,
  FileSpreadsheet,
  ChevronDown,
} from "lucide-react";
import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StatsHeaderProps {
  timetable: Map<string, TimetableSlot>;
  teachers: Teacher[];
  onAutoGenerate?: () => void;
  isGenerating?: boolean;
  selectedDay: Day;
  gridRef?: React.RefObject<HTMLDivElement | null>;
  maxFreePeriodsPerWeek?: number;
  maxFreePeriodsPerDay?: number;
  freePeriodsPerClass?: Record<string, number>;
}

export function StatsHeader({ timetable, teachers, onAutoGenerate, isGenerating, selectedDay, gridRef, maxFreePeriodsPerWeek = MAX_FREE_PERIODS_PER_WEEK, maxFreePeriodsPerDay = MAX_FREE_PERIODS_PER_DAY, freePeriodsPerClass = {} }: StatsHeaderProps) {
  const getMaxWeeklyFor = (cls: SchoolClass): number =>
    freePeriodsPerClass[cls] ?? maxFreePeriodsPerWeek;
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareTitle, setShareTitle] = useState("");

  const shareMutation = useMutation({
    mutationFn: async (title: string) => {
      const response = await apiRequest("POST", "/api/timetable/share", { title: title || undefined });
      return response.json();
    },
    onSuccess: (data: { shareId: string; shareUrl: string }) => {
      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      setShareUrl(fullUrl);
      toast({
        title: "Shareable Link Created",
        description: "Copy the link to share your timetable",
      });
    },
    onError: () => {
      toast({
        title: "Failed to Create Link",
        description: "Please try again",
        variant: "destructive",
      });
    },
  });

  // Period times for regular days
  const regularPeriodTimes: Record<number, string> = {
    1: "8:30 - 9:15",
    2: "9:15 - 10:00",
    3: "10:00 - 10:45",
    4: "10:45 - 11:30",
    5: "12:00 - 12:45",
    6: "12:45 - 1:30",
    7: "1:30 - 2:15",
    8: "2:30 - 3:15",
    9: "3:15 - 4:00",
  };

  // Period times for Friday
  const fridayPeriodTimes: Record<number, string> = {
    1: "8:30 - 9:15",
    2: "9:15 - 10:00",
    3: "10:00 - 10:45",
    4: "10:45 - 11:30",
    5: "12:30 - 1:15",
    6: "1:15 - 2:00",
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      
      // Add each day as a page
      let isFirstPage = true;
      for (const day of DAYS) {
        if (!isFirstPage) {
          doc.addPage();
        }
        isFirstPage = false;
        
        const periods = getPeriodsForDay(day);
        const periodTimes = day === "Friday" ? fridayPeriodTimes : regularPeriodTimes;
        
        // Title
        doc.setFontSize(16);
        doc.text(`${day} Timetable`, 14, 15);
        
        // Break info
        doc.setFontSize(10);
        const breakText = day === "Friday" 
          ? "Prayer: 11:30-12:00, Break: 12:00-12:30"
          : day === "Tuesday"
          ? "Break: 11:30-12:00"
          : "Break 1: 11:30-12:00, Break 2: 2:15-2:30";
        doc.text(breakText, 14, 22);
        
        // Build header row
        const headerRow = ["Class", ...periods.map(p => `P${p}\n${periodTimes[p] || ""}`)];
        
        // Build data rows
        const dataRows: string[][] = [];
        for (const schoolClass of CLASSES) {
          const row: string[] = [schoolClass];
          for (const period of periods) {
            const slot = timetable.get(getSlotKey(day, schoolClass, period));
            if (slot && slot.status === "occupied") {
              const teacher = teachers.find(t => t.id === slot.teacherId);
              const teacherName = teacher?.name || "";
              if (slot.slotType === "slash") {
                const slashTeacher = teachers.find(t => t.id === slot.slashPairTeacherId);
                row.push(`${slot.subject || ""}\n(${teacherName})\n/\n${slot.slashPairSubject || ""}\n(${slashTeacher?.name || ""})`);
              } else {
                const doubleMarker = slot.slotType === "double" ? " [D]" : "";
                row.push(`${slot.subject || ""}${doubleMarker}\n(${teacherName})`);
              }
            } else {
              row.push("");
            }
          }
          dataRows.push(row);
        }
        
        autoTable(doc, {
          head: [headerRow],
          body: dataRows,
          startY: 26,
          theme: "grid",
          styles: { fontSize: 8, cellPadding: 2, valign: "middle", halign: "center" },
          headStyles: { fillColor: [66, 139, 202], textColor: 255, fontStyle: "bold" },
          columnStyles: { 0: { fontStyle: "bold", halign: "left" } },
        });
      }
      
      // Add Statistics page
      doc.addPage();
      doc.setFontSize(16);
      doc.text("Timetable Statistics", 14, 15);
      
      // Summary stats
      doc.setFontSize(12);
      doc.text(`Total Slots: ${totalSlots}`, 14, 25);
      doc.text(`Scheduled: ${occupiedSlots}`, 14, 32);
      doc.text(`Free: ${freeSlots}`, 14, 39);
      doc.text(`Completion: ${completionPercent}%`, 14, 46);
      doc.text(`Teachers: ${teachers.length}`, 14, 53);
      
      // Free periods by class table
      doc.setFontSize(14);
      doc.text("Free Periods by Class", 14, 65);
      
      const freePeriodRows: string[][] = [];
      for (const schoolClass of CLASSES) {
        const maxWeekly = getMaxWeeklyFor(schoolClass as SchoolClass);
        const classStats = getFreePeriodStats(timetable, schoolClass as SchoolClass, maxWeekly, maxFreePeriodsPerDay);
        const filledCount = TOTAL_PERIODS_PER_WEEK - classStats.weeklyTotal;
        const status = classStats.weeklyExceeded || classStats.dailyExceededDays.length > 0 
          ? "Exceeds Limit" 
          : classStats.weeklyTotal === 0 
          ? "Complete" 
          : "OK";
        freePeriodRows.push([schoolClass, String(filledCount), String(classStats.weeklyTotal), String(maxWeekly), status]);
      }
      
      autoTable(doc, {
        head: [["Class", "Filled", "Free", "Limit", "Status"]],
        body: freePeriodRows,
        startY: 70,
        theme: "grid",
        styles: { fontSize: 10 },
        headStyles: { fillColor: [66, 139, 202] },
      });
      
      // Teacher workload table
      const finalY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 120;
      doc.setFontSize(14);
      doc.text("Teacher Workload", 14, finalY + 15);
      
      const teacherRows: string[][] = [];
      for (const teacher of teachers) {
        let periodCount = 0;
        for (const day of DAYS) {
          const periods = getPeriodsForDay(day);
          for (const period of periods) {
            for (const schoolClass of CLASSES) {
              const slot = timetable.get(getSlotKey(day, schoolClass, period));
              if (slot && (slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id)) {
                periodCount++;
              }
            }
          }
        }
        teacherRows.push([
          teacher.name,
          teacher.subjects.join(", "),
          teacher.classes.join(", "),
          String(periodCount),
        ]);
      }
      
      autoTable(doc, {
        head: [["Teacher", "Subjects", "Classes", "Periods"]],
        body: teacherRows,
        startY: finalY + 20,
        theme: "grid",
        styles: { fontSize: 9 },
        headStyles: { fillColor: [66, 139, 202] },
      });
      
      // Save the PDF
      doc.save("timetable-complete.pdf");
      
      toast({
        title: "Download Complete",
        description: "Timetable exported to PDF with all days and statistics",
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: "Could not generate PDF file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadExcel = async () => {
    setIsDownloading(true);
    try {
      const workbook = XLSX.utils.book_new();
      
      // Add each day as a sheet
      for (const day of DAYS) {
        const periods = getPeriodsForDay(day);
        const periodTimes = day === "Friday" ? fridayPeriodTimes : regularPeriodTimes;
        
        // Build header row
        const headerRow = ["Class", ...periods.map(p => `P${p} (${periodTimes[p] || ""})`)];
        
        // Build data rows
        const dataRows: string[][] = [];
        for (const schoolClass of CLASSES) {
          const row: string[] = [schoolClass];
          for (const period of periods) {
            const slot = timetable.get(getSlotKey(day, schoolClass, period));
            if (slot && slot.status === "occupied") {
              const teacher = teachers.find(t => t.id === slot.teacherId);
              const teacherName = teacher?.name || "";
              if (slot.slotType === "slash") {
                const slashTeacher = teachers.find(t => t.id === slot.slashPairTeacherId);
                row.push(`${slot.subject || ""} (${teacherName}) / ${slot.slashPairSubject || ""} (${slashTeacher?.name || ""})`);
              } else {
                const doubleMarker = slot.slotType === "double" ? " [D]" : "";
                row.push(`${slot.subject || ""}${doubleMarker} (${teacherName})`);
              }
            } else {
              row.push("");
            }
          }
          dataRows.push(row);
        }
        
        const sheetData = [headerRow, ...dataRows];
        const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
        
        // Set column widths
        worksheet["!cols"] = [{ wch: 8 }, ...periods.map(() => ({ wch: 25 }))];
        
        XLSX.utils.book_append_sheet(workbook, worksheet, day);
      }
      
      // Add Statistics sheet
      const statsData: (string | number)[][] = [
        ["Timetable Statistics"],
        [],
        ["Summary"],
        ["Total Slots", totalSlots],
        ["Scheduled", occupiedSlots],
        ["Free", freeSlots],
        ["Completion %", `${completionPercent}%`],
        ["Teachers", teachers.length],
        [],
        ["Free Periods by Class"],
        ["Class", "Filled", "Free", "Limit", "Status"],
      ];
      
      for (const schoolClass of CLASSES) {
        const maxWeekly = getMaxWeeklyFor(schoolClass as SchoolClass);
        const classStats = getFreePeriodStats(timetable, schoolClass as SchoolClass, maxWeekly, maxFreePeriodsPerDay);
        const filledCount = TOTAL_PERIODS_PER_WEEK - classStats.weeklyTotal;
        const status = classStats.weeklyExceeded || classStats.dailyExceededDays.length > 0 
          ? "Exceeds Limit" 
          : classStats.weeklyTotal === 0 
          ? "Complete" 
          : "OK";
        statsData.push([schoolClass, filledCount, classStats.weeklyTotal, maxWeekly, status]);
      }
      
      statsData.push([]);
      statsData.push(["Teacher Workload"]);
      statsData.push(["Teacher", "Subjects", "Classes", "Periods"]);
      
      for (const teacher of teachers) {
        let periodCount = 0;
        for (const day of DAYS) {
          const periods = getPeriodsForDay(day);
          for (const period of periods) {
            for (const schoolClass of CLASSES) {
              const slot = timetable.get(getSlotKey(day, schoolClass, period));
              if (slot && (slot.teacherId === teacher.id || slot.slashPairTeacherId === teacher.id)) {
                periodCount++;
              }
            }
          }
        }
        statsData.push([teacher.name, teacher.subjects.join(", "), teacher.classes.join(", "), periodCount]);
      }
      
      const statsSheet = XLSX.utils.aoa_to_sheet(statsData);
      statsSheet["!cols"] = [{ wch: 20 }, { wch: 30 }, { wch: 20 }, { wch: 10 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(workbook, statsSheet, "Statistics");
      
      // Save the file
      XLSX.writeFile(workbook, "timetable-complete.xlsx");
      
      toast({
        title: "Download Complete",
        description: "Timetable exported to Excel with all days and statistics",
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: "Could not generate Excel file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = () => {
    setShareUrl(null);
    setShareTitle("");
    setCopied(false);
    setShareDialogOpen(true);
  };

  const handleCreateShareLink = () => {
    shareMutation.mutate(shareTitle);
  };

  const handleCopyLink = async () => {
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
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
    <>
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Timetable Overview</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isDownloading}
                variant="outline"
                data-testid="button-download"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDownload} data-testid="menu-download-pdf">
                <FileText className="h-4 w-4 mr-2" />
                Download as PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadExcel} data-testid="menu-download-excel">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Download as Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={handleShare}
            variant="outline"
            data-testid="button-share"
          >
            <Share2 className="h-4 w-4 mr-2" />
            Share
          </Button>
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
              Auto-Generate
            </Button>
          )}
        </div>
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
          <span className="text-xs text-muted-foreground">(max {maxFreePeriodsPerWeek}/week, {maxFreePeriodsPerDay}/day)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {CLASSES.map((schoolClass) => {
            const maxWeeklyForClass = getMaxWeeklyFor(schoolClass as SchoolClass);
            const stats = getFreePeriodStats(timetable, schoolClass as SchoolClass, maxWeeklyForClass, maxFreePeriodsPerDay);
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
                    <p>Free: {stats.weeklyTotal} / {maxWeeklyForClass} max</p>
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

    <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Timetable</DialogTitle>
          <DialogDescription>
            Create a shareable link that anyone can view
          </DialogDescription>
        </DialogHeader>
        
        {!shareUrl ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="share-title">Title (optional)</Label>
              <Input
                id="share-title"
                placeholder="e.g., Term 1 Timetable 2025"
                value={shareTitle}
                onChange={(e) => setShareTitle(e.target.value)}
                data-testid="input-share-title"
              />
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreateShareLink}
                disabled={shareMutation.isPending}
                data-testid="button-create-share-link"
              >
                {shareMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4 mr-2" />
                )}
                Create Link
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Shareable Link</Label>
              <div className="flex gap-2">
                <Input
                  value={shareUrl}
                  readOnly
                  className="font-mono text-sm"
                  data-testid="input-share-url"
                />
                <Button
                  onClick={handleCopyLink}
                  variant="outline"
                  data-testid="button-copy-link"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Anyone with this link can view your timetable
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShareDialogOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
