import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Settings, Bell, Shield, Clock, Download, Upload, BookOpen, Loader2, Plus, Pencil, Trash2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SubjectQuota, Subject, UserSettings } from "@shared/schema";
import { findSlashPair, findSlashGroup, CLASSES } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NumberInput } from "@/components/ui/number-input";
import { useState, useEffect, useMemo } from "react";

export default function SettingsPage() {
  const { toast } = useToast();
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectJss1Quota, setNewSubjectJss1Quota] = useState(4);
  const [newSubjectJss2Quota, setNewSubjectJss2Quota] = useState(4);
  const [newSubjectJss3Quota, setNewSubjectJss3Quota] = useState(4);
  const [newSubjectSs1Quota, setNewSubjectSs1Quota] = useState(4);
  const [newSubjectSs2Quota, setNewSubjectSs2Quota] = useState(4);
  const [newSubjectSs3Quota, setNewSubjectSs3Quota] = useState(4);
  const [newSubjectIsSlash, setNewSubjectIsSlash] = useState(false);
  const [newSubjectSlashPair, setNewSubjectSlashPair] = useState<string>("");
  const [newSubjectSlashThird, setNewSubjectSlashThird] = useState<string>("");
  const [newSubjectPreferredJss1, setNewSubjectPreferredJss1] = useState<number[]>([]);
  const [newSubjectPreferredJss2, setNewSubjectPreferredJss2] = useState<number[]>([]);
  const [newSubjectPreferredJss3, setNewSubjectPreferredJss3] = useState<number[]>([]);
  const [newSubjectPreferredSs1, setNewSubjectPreferredSs1] = useState<number[]>([]);
  const [newSubjectPreferredSs2, setNewSubjectPreferredSs2] = useState<number[]>([]);
  const [newSubjectPreferredSs3, setNewSubjectPreferredSs3] = useState<number[]>([]);
  const [newSubjectDoublesJss1, setNewSubjectDoublesJss1] = useState(0);
  const [newSubjectDoublesJss2, setNewSubjectDoublesJss2] = useState(0);
  const [newSubjectDoublesJss3, setNewSubjectDoublesJss3] = useState(0);
  const [newSubjectDoublesSs1, setNewSubjectDoublesSs1] = useState(0);
  const [newSubjectDoublesSs2, setNewSubjectDoublesSs2] = useState(0);
  const [newSubjectDoublesSs3, setNewSubjectDoublesSs3] = useState(0);
  const [newSubjectSingleOnly, setNewSubjectSingleOnly] = useState(false);
  const [fatigueLimit, setFatigueLimit] = useState(5);
  const [maxFreePeriodsPerWeek, setMaxFreePeriodsPerWeek] = useState(3);
  const [maxFreePeriodsPerDay, setMaxFreePeriodsPerDay] = useState(2);
  const [freePeriodsPerClass, setFreePeriodsPerClass] = useState<Record<string, number>>({});
  const [allowDoublePeriods, setAllowDoublePeriods] = useState(true);
  const [allowDoubleInP8P9, setAllowDoubleInP8P9] = useState(true);

  const { data: quotas = [], isLoading: quotasLoading } = useQuery<SubjectQuota[]>({
    queryKey: ["/api/quotas"],
  });

  const { data: subjects = [], isLoading: subjectsLoading } = useQuery<Subject[]>({
    queryKey: ["/api/subjects"],
  });

  const { data: userSettings, isLoading: settingsLoading } = useQuery<UserSettings>({
    queryKey: ["/api/settings"],
  });

  // Sync settings from server
  useEffect(() => {
    if (userSettings) {
      if (userSettings.fatigueLimit) setFatigueLimit(userSettings.fatigueLimit);
      if (userSettings.maxFreePeriodsPerWeek !== undefined) setMaxFreePeriodsPerWeek(userSettings.maxFreePeriodsPerWeek);
      if (userSettings.maxFreePeriodsPerDay !== undefined) setMaxFreePeriodsPerDay(userSettings.maxFreePeriodsPerDay);
      if (userSettings.freePeriodsPerClass) setFreePeriodsPerClass(userSettings.freePeriodsPerClass);
      if (userSettings.allowDoublePeriods !== undefined) setAllowDoublePeriods(userSettings.allowDoublePeriods);
      if (userSettings.allowDoubleInP8P9 !== undefined) setAllowDoubleInP8P9(userSettings.allowDoubleInP8P9);
    }
  }, [userSettings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<UserSettings>) => {
      return apiRequest("PATCH", "/api/settings", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings Saved", description: "Fatigue limit has been updated" });
    },
    onError: (error) => {
      toast({
        title: "Failed to save settings",
        description: error instanceof Error ? error.message : "Could not save settings",
        variant: "destructive",
      });
    },
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

  const updateSlashGroupQuotaMutation = useMutation({
    mutationFn: async (payload: {
      subjects: string[];
      field: "jssQuota" | "jss1Quota" | "jss2Quota" | "jss3Quota" | "ss1Quota" | "ss2Quota" | "ss3Quota" | "ss2ss3Quota";
      value: number;
    }) => apiRequest("PATCH", "/api/quotas/slash-group", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to update slash group",
        description: error instanceof Error ? error.message : "Invalid quota value",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
    },
  });

  const createSubjectMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      jssQuota: number;
      jss1Quota: number;
      jss2Quota: number;
      jss3Quota: number;
      ss1Quota: number;
      ss2Quota: number;
      ss3Quota: number;
      ss2ss3Quota: number;
      isSlashSubject: boolean;
      slashPairName: string | null;
      slashThirdName: string | null;
      preferredPeriods?: { jss: number[]; jss1: number[]; jss2: number[]; jss3: number[]; ss1: number[]; ss2: number[]; ss3: number[]; ss2ss3: number[] };
      requiredDoubles?: { jss: number; jss1: number; jss2: number; jss3: number; ss1: number; ss2: number; ss3: number; ss2ss3: number };
      singleOnly?: boolean;
    }) => {
      return apiRequest("POST", "/api/subjects", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
      setSubjectDialogOpen(false);
      resetSubjectForm();
      toast({
        title: "School subject created",
        description: "The subject is now available to every class in this school.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create subject",
        description: error?.message || "Could not create subject",
        variant: "destructive",
      });
    },
  });

  const updateSubjectMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<Subject> }) => {
      return apiRequest("PATCH", `/api/subjects/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
      setSubjectDialogOpen(false);
      setEditingSubject(null);
      resetSubjectForm();
      toast({ title: "Subject Updated", description: "Subject has been updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update subject",
        description: error?.message || "Could not update subject",
        variant: "destructive",
      });
    },
  });

  const deleteSubjectMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/subjects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
      toast({ title: "Subject Deleted", description: "Subject has been removed" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete subject",
        description: error?.message || "Could not delete subject",
        variant: "destructive",
      });
    },
  });

  const handleQuotaChange = (subject: string, field: keyof SubjectQuota, value: number) => {
    updateQuotaMutation.mutate({ subject, updates: { [field]: value } });
  };

  const resetSubjectForm = () => {
    setNewSubjectName("");
    setNewSubjectJss1Quota(4);
    setNewSubjectJss2Quota(4);
    setNewSubjectJss3Quota(4);
    setNewSubjectSs1Quota(4);
    setNewSubjectSs2Quota(4);
    setNewSubjectSs3Quota(4);
    setNewSubjectIsSlash(false);
    setNewSubjectSlashPair("");
    setNewSubjectSlashThird("");
    setNewSubjectPreferredJss1([]);
    setNewSubjectPreferredJss2([]);
    setNewSubjectPreferredJss3([]);
    setNewSubjectPreferredSs1([]);
    setNewSubjectPreferredSs2([]);
    setNewSubjectPreferredSs3([]);
    setNewSubjectDoublesJss1(0);
    setNewSubjectDoublesJss2(0);
    setNewSubjectDoublesJss3(0);
    setNewSubjectDoublesSs1(0);
    setNewSubjectDoublesSs2(0);
    setNewSubjectDoublesSs3(0);
    setNewSubjectSingleOnly(false);
    setEditingSubject(null);
  };

  const openAddSubjectDialog = () => {
    resetSubjectForm();
    setSubjectDialogOpen(true);
  };

  const openEditSubjectDialog = (subject: Subject) => {
    setEditingSubject(subject);
    setNewSubjectName(subject.name);
    setNewSubjectJss1Quota(subject.jss1Quota ?? subject.jssQuota);
    setNewSubjectJss2Quota(subject.jss2Quota ?? subject.jssQuota);
    setNewSubjectJss3Quota(subject.jss3Quota ?? subject.jssQuota);
    setNewSubjectSs1Quota(subject.ss1Quota);
    setNewSubjectSs2Quota(subject.ss2Quota ?? subject.ss2ss3Quota);
    setNewSubjectSs3Quota(subject.ss3Quota ?? subject.ss2ss3Quota);
    setNewSubjectIsSlash(subject.isSlashSubject);
    setNewSubjectSlashPair(subject.slashPairName || "");
    setNewSubjectSlashThird(subject.slashThirdName || "");
    setNewSubjectPreferredJss1(subject.preferredPeriods?.jss1 ?? subject.preferredPeriods?.jss ?? []);
    setNewSubjectPreferredJss2(subject.preferredPeriods?.jss2 ?? subject.preferredPeriods?.jss ?? []);
    setNewSubjectPreferredJss3(subject.preferredPeriods?.jss3 ?? subject.preferredPeriods?.jss ?? []);
    setNewSubjectPreferredSs1(subject.preferredPeriods?.ss1 ?? []);
    setNewSubjectPreferredSs2(subject.preferredPeriods?.ss2 ?? subject.preferredPeriods?.ss2ss3 ?? []);
    setNewSubjectPreferredSs3(subject.preferredPeriods?.ss3 ?? subject.preferredPeriods?.ss2ss3 ?? []);
    setNewSubjectDoublesJss1(subject.requiredDoubles?.jss1 ?? subject.requiredDoubles?.jss ?? 0);
    setNewSubjectDoublesJss2(subject.requiredDoubles?.jss2 ?? subject.requiredDoubles?.jss ?? 0);
    setNewSubjectDoublesJss3(subject.requiredDoubles?.jss3 ?? subject.requiredDoubles?.jss ?? 0);
    setNewSubjectDoublesSs1(subject.requiredDoubles?.ss1 ?? 0);
    setNewSubjectDoublesSs2(subject.requiredDoubles?.ss2 ?? subject.requiredDoubles?.ss2ss3 ?? 0);
    setNewSubjectDoublesSs3(subject.requiredDoubles?.ss3 ?? subject.requiredDoubles?.ss2ss3 ?? 0);
    setNewSubjectSingleOnly(subject.singleOnly ?? false);
    setSubjectDialogOpen(true);
  };

  const slashPairCandidates = useMemo(
    () =>
      subjects.filter(
        (s) =>
          s.name !== newSubjectName &&
          (!editingSubject || s.id !== editingSubject.id),
      ),
    [subjects, newSubjectName, editingSubject],
  );

  const handleSubjectSubmit = () => {
    const isSlash = newSubjectIsSlash;
    const pairName = isSlash && newSubjectSlashPair ? newSubjectSlashPair : null;
    const thirdName = isSlash && newSubjectSlashThird ? newSubjectSlashThird : null;
    const preferredPeriods = {
      jss: [...newSubjectPreferredJss1].sort((a, b) => a - b),
      jss1: [...newSubjectPreferredJss1].sort((a, b) => a - b),
      jss2: [...newSubjectPreferredJss2].sort((a, b) => a - b),
      jss3: [...newSubjectPreferredJss3].sort((a, b) => a - b),
      ss1: [...newSubjectPreferredSs1].sort((a, b) => a - b),
      ss2: [...newSubjectPreferredSs2].sort((a, b) => a - b),
      ss3: [...newSubjectPreferredSs3].sort((a, b) => a - b),
      ss2ss3: Array.from(new Set([...newSubjectPreferredSs2, ...newSubjectPreferredSs3])).sort((a, b) => a - b),
    };
    const requiredDoubles = newSubjectSingleOnly
      ? { jss: 0, jss1: 0, jss2: 0, jss3: 0, ss1: 0, ss2: 0, ss3: 0, ss2ss3: 0 }
      : {
          jss: newSubjectDoublesJss1,
          jss1: newSubjectDoublesJss1,
          jss2: newSubjectDoublesJss2,
          jss3: newSubjectDoublesJss3,
          ss1: newSubjectDoublesSs1,
          ss2: newSubjectDoublesSs2,
          ss3: newSubjectDoublesSs3,
          ss2ss3: Math.max(newSubjectDoublesSs2, newSubjectDoublesSs3),
        };
    if (editingSubject) {
      updateSubjectMutation.mutate({
        id: editingSubject.id,
        updates: {
          name: newSubjectName,
          jssQuota: newSubjectJss1Quota,
          jss1Quota: newSubjectJss1Quota,
          jss2Quota: newSubjectJss2Quota,
          jss3Quota: newSubjectJss3Quota,
          ss1Quota: newSubjectSs1Quota,
          ss2Quota: newSubjectSs2Quota,
          ss3Quota: newSubjectSs3Quota,
          ss2ss3Quota: Math.max(newSubjectSs2Quota, newSubjectSs3Quota),
          isSlashSubject: isSlash,
          slashPairName: pairName,
        slashThirdName: thirdName,
          preferredPeriods,
          requiredDoubles,
          singleOnly: newSubjectSingleOnly,
        },
      });
    } else {
      createSubjectMutation.mutate({
        name: newSubjectName,
        jssQuota: newSubjectJss1Quota,
        jss1Quota: newSubjectJss1Quota,
        jss2Quota: newSubjectJss2Quota,
        jss3Quota: newSubjectJss3Quota,
        ss1Quota: newSubjectSs1Quota,
        ss2Quota: newSubjectSs2Quota,
        ss3Quota: newSubjectSs3Quota,
        ss2ss3Quota: Math.max(newSubjectSs2Quota, newSubjectSs3Quota),
        isSlashSubject: isSlash,
        slashPairName: pairName,
        slashThirdName: thirdName,
        preferredPeriods,
        requiredDoubles,
        singleOnly: newSubjectSingleOnly,
      });
    }
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
                  <Plus className="h-4 w-4" />
                  School Subjects
                </CardTitle>
                <CardDescription>
                  Each subject belongs to the current school and is available to JSS1 through SS3. Use the class quotas to control how often it is scheduled.
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={openAddSubjectDialog}
                data-testid="button-add-subject"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Subject
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {subjectsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No school subjects yet. Click "Add Subject" to create one for all classes in this school.
              </p>
            ) : (
              <div className="space-y-2">
                {subjects.map((subject) => (
                  <div
                    key={subject.id}
                    className="flex items-center justify-between gap-4 p-3 rounded-md border"
                    data-testid={`subject-row-${subject.id}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{subject.name}</span>
                        <Badge variant="secondary">All classes</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                        <span>JSS1: {subject.jss1Quota ?? subject.jssQuota}</span>
                        <span>JSS2: {subject.jss2Quota ?? subject.jssQuota}</span>
                        <span>JSS3: {subject.jss3Quota ?? subject.jssQuota}</span>
                        <span>SS1: {subject.ss1Quota}</span>
                        <span>SS2: {subject.ss2Quota ?? subject.ss2ss3Quota}</span>
                        <span>SS3: {subject.ss3Quota ?? subject.ss2ss3Quota}</span>
                        <span className="font-medium text-foreground">Total: {(subject.jss1Quota ?? subject.jssQuota) + (subject.jss2Quota ?? subject.jssQuota) + (subject.jss3Quota ?? subject.jssQuota) + subject.ss1Quota + (subject.ss2Quota ?? subject.ss2ss3Quota) + (subject.ss3Quota ?? subject.ss2ss3Quota)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEditSubjectDialog(subject)}
                        data-testid={`button-edit-subject-${subject.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteSubjectMutation.mutate(subject.id)}
                        disabled={deleteSubjectMutation.isPending}
                        data-testid={`button-delete-subject-${subject.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={subjectDialogOpen} onOpenChange={setSubjectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSubject ? "Edit Subject" : "Add New Subject"}</DialogTitle>
              <DialogDescription>
                {editingSubject
                  ? "Update this school-wide subject and its weekly quota for each class."
                  : "Create the subject once for every class in this school, then set each class's weekly quota."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="subject-name">Subject Name</Label>
                <Input
                  id="subject-name"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="e.g., French, Computer Science"
                  data-testid="input-subject-name"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {([
                  ["JSS1", "jss1-quota", newSubjectJss1Quota, setNewSubjectJss1Quota],
                  ["JSS2", "jss2-quota", newSubjectJss2Quota, setNewSubjectJss2Quota],
                  ["JSS3", "jss3-quota", newSubjectJss3Quota, setNewSubjectJss3Quota],
                  ["SS1", "ss1-quota", newSubjectSs1Quota, setNewSubjectSs1Quota],
                  ["SS2", "ss2-quota", newSubjectSs2Quota, setNewSubjectSs2Quota],
                  ["SS3", "ss3-quota", newSubjectSs3Quota, setNewSubjectSs3Quota],
                ] as const).map(([label, id, value, setter]) => (
                  <div className="space-y-2" key={id}>
                    <Label htmlFor={id}>{label} Quota</Label>
                    <NumberInput
                      id={id}
                      min={0}
                      max={10}
                      value={value}
                      onChange={setter}
                      data-testid={`input-${id}`}
                    />
                  </div>
                ))}
              </div>
              <div className="bg-muted/50 rounded-md p-3 mt-2">
                <p className="text-sm font-medium">
                  Total Weekly Periods: {newSubjectJss1Quota + newSubjectJss2Quota + newSubjectJss3Quota + newSubjectSs1Quota + newSubjectSs2Quota + newSubjectSs3Quota}
                </p>
                <p className="text-xs text-muted-foreground">
                  JSS1 ({newSubjectJss1Quota}) + JSS2 ({newSubjectJss2Quota}) + JSS3 ({newSubjectJss3Quota}) + SS1 ({newSubjectSs1Quota}) + SS2 ({newSubjectSs2Quota}) + SS3 ({newSubjectSs3Quota})
                </p>
              </div>

              <div className="space-y-4 border-t pt-4">
                <div>
                  <Label className="text-sm font-medium">Preferred periods</Label>
                  <p className="text-xs text-muted-foreground">
                    Pick the periods this subject should land in first. Leave empty to allow any period.
                  </p>
                </div>
                {(["jss1", "jss2", "jss3", "ss1", "ss2", "ss3"] as const).map((lvl) => {
                  const label = lvl === "jss1" ? "JSS1" : lvl === "jss2" ? "JSS2" : lvl === "jss3" ? "JSS3" : lvl === "ss1" ? "SS1" : lvl === "ss2" ? "SS2" : "SS3";
                  const value =
                    lvl === "jss1" ? newSubjectPreferredJss1
                    : lvl === "jss2" ? newSubjectPreferredJss2
                    : lvl === "jss3" ? newSubjectPreferredJss3
                    : lvl === "ss1" ? newSubjectPreferredSs1
                    : lvl === "ss2" ? newSubjectPreferredSs2
                    : newSubjectPreferredSs3;
                  const setter =
                    lvl === "jss1" ? setNewSubjectPreferredJss1
                    : lvl === "jss2" ? setNewSubjectPreferredJss2
                    : lvl === "jss3" ? setNewSubjectPreferredJss3
                    : lvl === "ss1" ? setNewSubjectPreferredSs1
                    : lvl === "ss2" ? setNewSubjectPreferredSs2
                    : setNewSubjectPreferredSs3;
                  return (
                    <div key={lvl} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{label}</Label>
                      <div className="flex flex-wrap gap-1">
                        {Array.from({ length: 9 }, (_, i) => i + 1).map((p) => {
                          const on = value.includes(p);
                          return (
                            <Button
                              key={p}
                              type="button"
                              size="sm"
                              variant={on ? "default" : "outline"}
                              className="h-7 w-9 p-0 text-xs"
                              onClick={() =>
                                setter(on ? value.filter((x) => x !== p) : [...value, p])
                              }
                              data-testid={`chip-pref-${lvl}-${p}`}
                            >
                              P{p}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="subject-single-only">Single periods only</Label>
                    <p className="text-xs text-muted-foreground">
                      Never schedule this subject as a double period.
                    </p>
                  </div>
                  <Switch
                    id="subject-single-only"
                    checked={newSubjectSingleOnly}
                    onCheckedChange={setNewSubjectSingleOnly}
                    data-testid="switch-subject-single-only"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Required doubles per week</Label>
                  <p className="text-xs text-muted-foreground">
                    {newSubjectSingleOnly
                      ? "Disabled — this subject is set to single periods only."
                      : "Number of double-period blocks the generator must place per class."}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {([
                    ["JSS1", "doubles-jss1", newSubjectDoublesJss1, setNewSubjectDoublesJss1],
                    ["JSS2", "doubles-jss2", newSubjectDoublesJss2, setNewSubjectDoublesJss2],
                    ["JSS3", "doubles-jss3", newSubjectDoublesJss3, setNewSubjectDoublesJss3],
                    ["SS1", "doubles-ss1", newSubjectDoublesSs1, setNewSubjectDoublesSs1],
                    ["SS2", "doubles-ss2", newSubjectDoublesSs2, setNewSubjectDoublesSs2],
                    ["SS3", "doubles-ss3", newSubjectDoublesSs3, setNewSubjectDoublesSs3],
                  ] as const).map(([label, id, value, setter]) => (
                    <div className="space-y-1" key={id}>
                      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
                      <NumberInput
                        id={id}
                        min={0}
                        max={4}
                        value={newSubjectSingleOnly ? 0 : value}
                        onChange={setter}
                        disabled={newSubjectSingleOnly}
                        data-testid={`input-${id}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="subject-is-slash">Slash subject</Label>
                    <p className="text-xs text-muted-foreground">
                      Schedule this subject in the same period as a paired subject (e.g. Physics / Literature).
                    </p>
                  </div>
                  <Switch
                    id="subject-is-slash"
                    checked={newSubjectIsSlash}
                    onCheckedChange={(v) => {
                      setNewSubjectIsSlash(v);
                      if (!v) {
                        setNewSubjectSlashPair("");
                        setNewSubjectSlashThird("");
                      }
                    }}
                    data-testid="switch-subject-slash"
                  />
                </div>
                {newSubjectIsSlash && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="subject-slash-pair">Slash partner 1</Label>
                      <Select
                        value={newSubjectSlashPair}
                        onValueChange={(v) => {
                          setNewSubjectSlashPair(v);
                          if (newSubjectSlashThird === v) setNewSubjectSlashThird("");
                        }}
                      >
                        <SelectTrigger id="subject-slash-pair" data-testid="select-subject-slash-pair">
                          <SelectValue placeholder="Choose the second subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {slashPairCandidates.map((s) => (
                            <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="subject-slash-third">Slash partner 2 (optional)</Label>
                      <Select
                        value={newSubjectSlashThird || "none"}
                        onValueChange={(v) => setNewSubjectSlashThird(v === "none" ? "" : v)}
                      >
                        <SelectTrigger id="subject-slash-third" data-testid="select-subject-slash-third">
                          <SelectValue placeholder="Add a third subject" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No third subject</SelectItem>
                          {slashPairCandidates
                            .filter((s) => s.name !== newSubjectSlashPair)
                            .map((s) => (
                              <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A slash group can contain 2 or 3 subjects. All members are scheduled in the same period with different teachers.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSubjectDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubjectSubmit}
                disabled={!newSubjectName.trim() || (newSubjectIsSlash && !newSubjectSlashPair) || createSubjectMutation.isPending || updateSubjectMutation.isPending}
                data-testid="button-submit-subject"
              >
                {createSubjectMutation.isPending || updateSubjectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                {editingSubject ? "Update Subject" : "Create Subject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {quotasLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="bg-muted/50 rounded-md p-4 mb-2">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-sm font-medium">Total Weekly Periods (All Classes)</p>
                      <p className="text-xs text-muted-foreground">
                        Each class has 40 periods/week. With up to 3 free periods allowed, target 37-40 periods per class.
                      </p>
                    </div>
                    <div className="text-right">
                      {(() => {
                        // Slash groups occupy one timetable slot within each senior class.
                        // SS2 and SS3 now have independent quotas, so calculate them separately.
                        const seenGroups = new Set<string>();
                        const slashNames = new Set<string>();
                        const seniorSlashGroups: string[][] = [];
                        for (const s of subjects) {
                          if (!s.isSlashSubject) continue;
                          const group = findSlashGroup(subjects, s.name);
                          if (group.length < 2) continue;
                          const names = group.map((item) => item.name).sort();
                          const key = names.join("|");
                          names.forEach((name) => slashNames.add(name));
                          if (seenGroups.has(key)) continue;
                          seenGroups.add(key);
                          seniorSlashGroups.push(names);
                        }
                        const seniorTotal = (field: "ss2Quota" | "ss3Quota") => {
                          const valueFor = (q: SubjectQuota) => q[field] ?? q.ss2ss3Quota;
                          const slashTotal = seniorSlashGroups.reduce((sum, names) => {
                            const groupQuota = Math.max(
                              ...names.map((name) => {
                                const q = quotas.find((item) => item.subject === name);
                                return q ? valueFor(q) : 0;
                              }),
                            );
                            return sum + groupQuota;
                          }, 0);
                          const regularTotal = quotas
                            .filter((q) => valueFor(q) > 0 && !slashNames.has(q.subject))
                            .reduce((sum, q) => sum + valueFor(q), 0);
                          return slashTotal + regularTotal;
                        };
                        const jss1Total = quotas.reduce((sum, q) => sum + (q.jss1Quota ?? q.jssQuota), 0);
                        const jss2Total = quotas.reduce((sum, q) => sum + (q.jss2Quota ?? q.jssQuota), 0);
                        const jss3Total = quotas.reduce((sum, q) => sum + (q.jss3Quota ?? q.jssQuota), 0);
                        const ss1Total = quotas.reduce((sum, q) => sum + q.ss1Quota, 0);
                        const ss2Total = seniorTotal("ss2Quota");
                        const ss3Total = seniorTotal("ss3Quota");
                        
                        const jss1InRange = jss1Total >= 37 && jss1Total <= 40;
                        const jss2InRange = jss2Total >= 37 && jss2Total <= 40;
                        const jss3InRange = jss3Total >= 37 && jss3Total <= 40;
                        const ss1InRange = ss1Total >= 37 && ss1Total <= 40;
                        const ss2InRange = ss2Total >= 37 && ss2Total <= 40;
                        const ss3InRange = ss3Total >= 37 && ss3Total <= 40;
                        
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center justify-end gap-2">
                              <span className={`text-sm ${jss1InRange ? 'text-green-600' : jss1Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                JSS1: {jss1Total}/40
                              </span>
                              <span className={`text-sm ${jss2InRange ? 'text-green-600' : jss2Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                JSS2: {jss2Total}/40
                              </span>
                              <span className={`text-sm ${jss3InRange ? 'text-green-600' : jss3Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                JSS3: {jss3Total}/40
                              </span>
                              <span className={`text-sm ${ss1InRange ? 'text-green-600' : ss1Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                SS1: {ss1Total}/40
                              </span>
                              <span className={`text-sm ${ss2InRange ? 'text-green-600' : ss2Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                SS2: {ss2Total}/40
                              </span>
                              <span className={`text-sm ${ss3InRange ? 'text-green-600' : ss3Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                SS3: {ss3Total}/40
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Target: 37-40 periods per class (up to 3 free periods allowed)
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <Separator />

                {([
                  ["JSS1", "jss1Quota"],
                  ["JSS2", "jss2Quota"],
                  ["JSS3", "jss3Quota"],
                ] as const).map(([label, field], index) => {
                  const valueFor = (q: SubjectQuota) => q[field] ?? q.jssQuota;
                  const total = quotas.reduce((sum, q) => sum + valueFor(q), 0);
                  return (
                    <div key={field}>
                      {index > 0 && <Separator className="mb-6" />}
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">{label} Subjects</h3>
                        <Badge variant="secondary">{total} periods/class</Badge>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[...quotas]
                          .filter((q) => valueFor(q) > 0)
                          .sort((a, b) => a.subject.localeCompare(b.subject))
                          .map((q) => (
                            <QuotaInput
                              key={`${field}-${q.subject}`}
                              subject={q.subject}
                              value={valueFor(q)}
                              onChange={(v) => handleQuotaChange(q.subject, field, v)}
                              isSlash={q.isSlashSubject}
                              sectionTotal={valueFor(q)}
                              testIdSuffix={field}
                            />
                          ))}
                      </div>
                    </div>
                  );
                })}

                <Separator />

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">SS1 Subjects</h3>
                    <Badge variant="secondary">
                      {quotas.reduce((sum, q) => sum + q.ss1Quota, 0)} periods/class
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[...quotas]
                      .filter((q) => q.ss1Quota > 0)
                      .sort((a, b) => a.subject.localeCompare(b.subject))
                      .map((q) => (
                        <QuotaInput
                          key={q.subject}
                          subject={q.subject}
                          value={q.ss1Quota}
                          onChange={(v) => handleQuotaChange(q.subject, "ss1Quota", v)}
                          isSlash={q.isSlashSubject}
                          sectionTotal={q.ss1Quota}
                        />
                      ))}
                  </div>
                </div>

                <Separator />

                {([
                  ["SS2", "ss2Quota"],
                  ["SS3", "ss3Quota"],
                ] as const).map(([label, field], index) => {
                  const valueFor = (q: SubjectQuota) => q[field] ?? q.ss2ss3Quota;
                  const seenGroups = new Set<string>();
                  const allGroups: string[][] = [];
                  const slashNamesForBadge = new Set<string>();
                  for (const s of subjects) {
                    if (!s.isSlashSubject) continue;
                    const group = findSlashGroup(subjects, s.name);
                    if (group.length < 2) continue;
                    const names = group.map((x) => x.name).sort();
                    const key = names.join("|");
                    if (seenGroups.has(key)) continue;
                    seenGroups.add(key);
                    names.forEach((name) => slashNamesForBadge.add(name));
                    allGroups.push(names);
                  }
                  const groups = allGroups.filter((names) =>
                    Math.max(...names.map((name) => {
                      const q = quotas.find((item) => item.subject === name);
                      return q ? valueFor(q) : 0;
                    })) > 0
                  );
                  const slashTotal = groups.reduce((sum, names) =>
                    sum + Math.max(...names.map((name) => {
                      const q = quotas.find((item) => item.subject === name);
                      return q ? valueFor(q) : 0;
                    })), 0
                  );
                  const regularSubjects = [...quotas]
                    .filter((q) => valueFor(q) > 0 && !slashNamesForBadge.has(q.subject))
                    .sort((a, b) => a.subject.localeCompare(b.subject));
                  const regularTotal = regularSubjects.reduce((sum, q) => sum + valueFor(q), 0);
                  const perClass = slashTotal + regularTotal;

                  return (
                    <div key={field}>
                      {index > 0 && <Separator className="mb-6" />}
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">{label} Subjects (includes slash pairing)</h3>
                        <Badge variant="secondary">{perClass} periods/class</Badge>
                      </div>

                      {groups.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm text-muted-foreground mb-3">Slash Subject Groups (scheduled simultaneously)</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {groups.map((names) => {
                              const quota = Math.max(...names.map((name) => {
                                const q = quotas.find((item) => item.subject === name);
                                return q ? valueFor(q) : 0;
                              }));
                              return (
                                <div key={names.join("-")} className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <Label className="text-sm flex items-center gap-1">
                                      {names.join(" / ")}
                                      <Badge variant="outline" className="text-xs ml-1">Slash</Badge>
                                    </Label>
                                  </div>
                                  <NumberInput
                                    min={0}
                                    max={10}
                                    value={quota}
                                    onChange={(v) => {
                                      updateSlashGroupQuotaMutation.mutate({
                                        subjects: names,
                                        field,
                                        value: v,
                                      });
                                    }}
                                    className="w-16"
                                    data-testid={`input-quota-${label.toLowerCase()}-slash-${names.join("-").toLowerCase()}`}
                                  />
                                  <span className="text-sm text-muted-foreground">per week</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {regularSubjects.length > 0 && (
                        <>
                          <p className="text-sm text-muted-foreground mb-3">Regular Subjects</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {regularSubjects.map((q) => (
                              <QuotaInput
                                key={`${field}-${q.subject}`}
                                subject={q.subject}
                                value={valueFor(q)}
                                onChange={(v) => handleQuotaChange(q.subject, field, v)}
                                isSlash={false}
                                sectionTotal={valueFor(q)}
                                testIdSuffix={field}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5 flex-1">
                <Label>Teacher Fatigue Limit</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum consecutive teaching periods allowed per teacher per day (1-10)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <NumberInput
                  min={1}
                  max={10}
                  value={fatigueLimit}
                  onChange={setFatigueLimit}
                  className="w-20"
                  data-testid="input-fatigue-limit"
                />
                <Button
                  size="sm"
                  onClick={() => updateSettingsMutation.mutate({ fatigueLimit })}
                  disabled={updateSettingsMutation.isPending || settingsLoading}
                  data-testid="button-save-fatigue-limit"
                >
                  {updateSettingsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            </div>
            <Separator />
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-0.5 flex-1">
                  <Label>Max Free Periods Per Week (per class)</Label>
                  <p className="text-sm text-muted-foreground">
                    Set a fixed number of free periods allowed each week for each class (0-10).
                    Leave at the default to fall back to the global value below.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Default</Label>
                    <NumberInput
                      min={0}
                      max={10}
                      value={maxFreePeriodsPerWeek}
                      onChange={(n) => setMaxFreePeriodsPerWeek(n)}
                      className="w-20"
                      data-testid="input-max-free-week"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => updateSettingsMutation.mutate({ maxFreePeriodsPerWeek, freePeriodsPerClass })}
                    disabled={updateSettingsMutation.isPending || settingsLoading}
                    data-testid="button-save-max-free-week"
                  >
                    {updateSettingsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-1" />
                        Save
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 bg-muted/40 rounded-md p-3">
                {CLASSES.map((cls) => {
                  const override = freePeriodsPerClass[cls];
                  const value = override ?? maxFreePeriodsPerWeek;
                  const isOverride = override !== undefined;
                  return (
                    <div key={cls} className="flex flex-col gap-1">
                      <Label className="text-xs flex items-center justify-between gap-1">
                        <span>{cls}</span>
                        {isOverride && (
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:text-foreground underline"
                            onClick={() =>
                              setFreePeriodsPerClass((prev) => {
                                const next = { ...prev };
                                delete next[cls];
                                return next;
                              })
                            }
                            data-testid={`button-reset-free-${cls.toLowerCase()}`}
                          >
                            reset
                          </button>
                        )}
                      </Label>
                      <NumberInput
                        min={0}
                        max={10}
                        value={value}
                        onChange={(n) =>
                          setFreePeriodsPerClass((prev) => {
                            const next = { ...prev };
                            if (n === maxFreePeriodsPerWeek) {
                              delete next[cls];
                            } else {
                              next[cls] = n;
                            }
                            return next;
                          })
                        }
                        className={`text-center ${isOverride ? "border-primary" : ""}`}
                        data-testid={`input-free-${cls.toLowerCase()}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <Separator />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5 flex-1">
                <Label>Max Free Periods Per Day</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum free periods allowed per class per day (0-5)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <NumberInput
                  min={0}
                  max={5}
                  value={maxFreePeriodsPerDay}
                  onChange={(n) => setMaxFreePeriodsPerDay(n)}
                  className="w-20"
                  data-testid="input-max-free-day"
                />
                <Button
                  size="sm"
                  onClick={() => updateSettingsMutation.mutate({ maxFreePeriodsPerDay })}
                  disabled={updateSettingsMutation.isPending || settingsLoading}
                  data-testid="button-save-max-free-day"
                >
                  {updateSettingsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1" />
                      Save
                    </>
                  )}
                </Button>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Allow Double Periods</Label>
                <p className="text-sm text-muted-foreground">
                  Allow subjects to be scheduled as double periods (2 consecutive)
                </p>
              </div>
              <Switch 
                checked={allowDoublePeriods}
                onCheckedChange={(checked) => {
                  setAllowDoublePeriods(checked);
                  updateSettingsMutation.mutate({ allowDoublePeriods: checked });
                }}
                data-testid="switch-allow-double"
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Allow Double Periods in P8/P9</Label>
                <p className="text-sm text-muted-foreground">
                  Allow double periods to be scheduled in periods 8 and 9
                </p>
              </div>
              <Switch 
                checked={allowDoubleInP8P9}
                onCheckedChange={(checked) => {
                  setAllowDoubleInP8P9(checked);
                  updateSettingsMutation.mutate({ allowDoubleInP8P9: checked });
                }}
                disabled={!allowDoublePeriods}
                data-testid="switch-allow-double-p8p9"
              />
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
  isSlash,
  sectionTotal,
  testIdSuffix = "",
}: { 
  subject: string; 
  value: number; 
  onChange: (value: number) => void;
  isSlash: boolean;
  sectionTotal: number;
  testIdSuffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <Label className="text-sm flex items-center gap-1">
          {subject}
          {isSlash && (
            <Badge variant="outline" className="text-xs ml-1">Slash</Badge>
          )}
          <span className="text-xs text-muted-foreground ml-1">({sectionTotal} total)</span>
        </Label>
      </div>
      <NumberInput
        min={0}
        max={10}
        value={value}
        onChange={onChange}
        className="w-16"
        data-testid={`input-quota-${testIdSuffix ? `${testIdSuffix}-` : ""}${subject.toLowerCase().replace(/\s+/g, "-")}`}
      />
      <span className="text-sm text-muted-foreground">per week</span>
    </div>
  );
}
