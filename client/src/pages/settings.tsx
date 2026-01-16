import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Settings, Bell, Shield, Clock, Download, Upload, BookOpen, RotateCcw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SubjectQuota } from "@shared/schema";
import { useState, useEffect } from "react";

export default function SettingsPage() {
  const { toast } = useToast();

  const { data: quotas = [], isLoading: quotasLoading } = useQuery<SubjectQuota[]>({
    queryKey: ["/api/quotas"],
  });

  const updateQuotaMutation = useMutation({
    mutationFn: async ({ subject, updates }: { subject: string; updates: Partial<SubjectQuota> }) => {
      return apiRequest("PATCH", `/api/quotas/${encodeURIComponent(subject)}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to update quota",
        description: error instanceof Error ? error.message : "Invalid quota value",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
    },
  });

  const resetQuotasMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/quotas/reset");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
      toast({
        title: "Quotas Reset",
        description: "Subject quotas have been reset to default values",
      });
    },
  });

  const handleQuotaChange = (subject: string, field: keyof SubjectQuota, value: number) => {
    updateQuotaMutation.mutate({ subject, updates: { [field]: value } });
  };

  const handleExport = () => {
    toast({
      title: "Export Started",
      description: "Your timetable data is being prepared for download",
    });
  };

  const handleImport = () => {
    toast({
      title: "Import Feature",
      description: "Import functionality will be available in a future update",
    });
  };

  const jssSubjects = quotas.filter(q => q.jssQuota > 0 || (!q.isSlashSubject && q.ss1Quota === 0 && q.ss2ss3Quota === 0));
  const ssSubjects = quotas.filter(q => q.ss1Quota > 0 || q.ss2ss3Quota > 0);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure your timetable builder preferences
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Subject Period Quotas
                </CardTitle>
                <CardDescription>
                  Set maximum periods per week for each subject
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resetQuotasMutation.mutate()}
                disabled={resetQuotasMutation.isPending}
                data-testid="button-reset-quotas"
              >
                {resetQuotasMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Reset to Defaults
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {quotasLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div>
                  <h3 className="font-medium mb-3">JSS Subjects (JSS1-JSS3)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {quotas.filter(q => q.jssQuota > 0).map((quota) => (
                      <QuotaInput
                        key={quota.subject}
                        subject={quota.subject}
                        value={quota.jssQuota}
                        onChange={(v) => handleQuotaChange(quota.subject, "jssQuota", v)}
                        isSlash={quota.isSlashSubject}
                      />
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="font-medium mb-3">SS1 Subjects</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {quotas.filter(q => q.ss1Quota > 0).map((quota) => (
                      <QuotaInput
                        key={quota.subject}
                        subject={quota.subject}
                        value={quota.ss1Quota}
                        onChange={(v) => handleQuotaChange(quota.subject, "ss1Quota", v)}
                        isSlash={quota.isSlashSubject}
                      />
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="font-medium mb-3">SS2/SS3 Subjects (includes slash pairing)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {quotas.filter(q => q.ss2ss3Quota > 0).map((quota) => (
                      <QuotaInput
                        key={quota.subject}
                        subject={quota.subject}
                        value={quota.ss2ss3Quota}
                        onChange={(v) => handleQuotaChange(quota.subject, "ss2ss3Quota", v)}
                        isSlash={quota.isSlashSubject}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Validation Rules
            </CardTitle>
            <CardDescription>
              Enable or disable specific validation rules
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Teacher Clash Prevention</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent teachers from being scheduled in multiple classes simultaneously
                </p>
              </div>
              <Switch defaultChecked disabled />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Fatigue Limit (5 consecutive)</Label>
                <p className="text-sm text-muted-foreground">
                  Limit teachers to maximum 5 consecutive teaching periods
                </p>
              </div>
              <Switch defaultChecked disabled />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Break Enforcement</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent double periods from crossing breaks
                </p>
              </div>
              <Switch defaultChecked disabled />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>English-Security Separation</Label>
                <p className="text-sm text-muted-foreground">
                  Prevent Security from immediately following English
                </p>
              </div>
              <Switch defaultChecked disabled />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Period Quota Warnings</Label>
                <p className="text-sm text-muted-foreground">
                  Show warnings when subject quotas are exceeded
                </p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Schedule Configuration
            </CardTitle>
            <CardDescription>
              Current timetable structure (read-only)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Monday</Label>
                <p className="font-medium">P1 - P9</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Tuesday</Label>
                <p className="font-medium">P1 - P7</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Wednesday</Label>
                <p className="font-medium">P1 - P9</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Thursday</Label>
                <p className="font-medium">P1 - P9</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Friday</Label>
                <p className="font-medium">P1 - P6</p>
              </div>
            </div>
            <Separator />
            <div>
              <Label className="text-muted-foreground">Break Times</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary">After P4 (All days)</Badge>
                <Badge variant="secondary">After P7 (Mon-Thu)</Badge>
                <Badge variant="outline">Friday: Prayer 11:30-12:00</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </CardTitle>
            <CardDescription>
              Configure notification preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Validation Alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Show toast notifications for validation errors
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Success Messages</Label>
                <p className="text-sm text-muted-foreground">
                  Show confirmation when actions complete
                </p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data Management</CardTitle>
            <CardDescription>
              Export or import your timetable data
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={handleExport} data-testid="button-export">
              <Download className="h-4 w-4 mr-2" />
              Export Timetable
            </Button>
            <Button variant="outline" onClick={handleImport} data-testid="button-import">
              <Upload className="h-4 w-4 mr-2" />
              Import Data
            </Button>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

function QuotaInput({ 
  subject, 
  value, 
  onChange, 
  isSlash 
}: { 
  subject: string; 
  value: number; 
  onChange: (value: number) => void;
  isSlash: boolean;
}) {
  const [localValue, setLocalValue] = useState(value.toString());
  
  useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  const handleBlur = () => {
    const numValue = parseInt(localValue) || 0;
    const clampedValue = Math.max(0, Math.min(10, numValue));
    setLocalValue(clampedValue.toString());
    if (clampedValue !== value) {
      onChange(clampedValue);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <Label className="text-sm flex items-center gap-1">
          {subject}
          {isSlash && (
            <Badge variant="outline" className="text-xs ml-1">Slash</Badge>
          )}
        </Label>
      </div>
      <Input
        type="number"
        min={0}
        max={10}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        className="w-16 text-center"
        data-testid={`input-quota-${subject.toLowerCase().replace(/\s+/g, "-")}`}
      />
      <span className="text-sm text-muted-foreground">per week</span>
    </div>
  );
}
