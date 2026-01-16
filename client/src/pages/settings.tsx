import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Settings, Bell, Shield, Clock, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { toast } = useToast();

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

  return (
    <ScrollArea className="h-full">
      <div className="p-6 max-w-3xl mx-auto space-y-6">
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
