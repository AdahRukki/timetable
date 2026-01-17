import { type TimetableSlot, type Teacher, type SchoolClass, type Day, DAYS, CLASSES } from "@shared/schema";
import { getPeriodsForDay, getSlotKey, getFreePeriodStats, MAX_FREE_PERIODS_PER_WEEK, MAX_FREE_PERIODS_PER_DAY, TOTAL_PERIODS_PER_WEEK } from "@/lib/timetable-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import html2canvas from "html2canvas";
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
}

export function StatsHeader({ timetable, teachers, onAutoGenerate, isGenerating, selectedDay, gridRef }: StatsHeaderProps) {
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

  const handleDownload = async () => {
    if (!gridRef?.current) {
      toast({
        title: "Download Error",
        description: "Timetable grid not found. Please try again.",
        variant: "destructive",
      });
      return;
    }
    
    setIsDownloading(true);
    try {
      const canvas = await html2canvas(gridRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      
      const link = document.createElement("a");
      link.download = `timetable-${selectedDay.toLowerCase()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      
      toast({
        title: "Download Complete",
        description: `Timetable for ${selectedDay} saved as image`,
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Download Failed",
        description: "Could not generate image. Please try again.",
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
          <Button
            onClick={handleDownload}
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
          </Button>
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
