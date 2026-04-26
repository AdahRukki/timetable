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
import type {
  SubjectQuota,
  Subject,
  UserSettings,
  SchoolClass,
  PreferredPeriods,
  RequiredDoubles,
  QuotaField,
} from "@shared/schema";
import { findSlashPair, CLASSES, classKey, quotaFieldForClass } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NumberInput } from "@/components/ui/number-input";
import { useState, useEffect, useMemo } from "react";

type ClassKey = keyof PreferredPeriods;
const EMPTY_QUOTAS: Record<ClassKey, number> = {
  jss1: 4, jss2: 4, jss3: 4, ss1: 4, ss2: 4, ss3: 4,
};
const EMPTY_PREFERRED: Record<ClassKey, number[]> = {
  jss1: [], jss2: [], jss3: [], ss1: [], ss2: [], ss3: [],
};
const EMPTY_DOUBLES: Record<ClassKey, number> = {
  jss1: 0, jss2: 0, jss3: 0, ss1: 0, ss2: 0, ss3: 0,
};
const CLASS_LABELS: Record<ClassKey, string> = {
  jss1: "JSS1", jss2: "JSS2", jss3: "JSS3", ss1: "SS1", ss2: "SS2", ss3: "SS3",
};
const CLASS_KEYS: ClassKey[] = ["jss1", "jss2", "jss3", "ss1", "ss2", "ss3"];

export default function SettingsPage() {
  const { toast } = useToast();
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectQuotas, setNewSubjectQuotas] = useState<Record<ClassKey, number>>({ ...EMPTY_QUOTAS });
  const [newSubjectIsSlash, setNewSubjectIsSlash] = useState(false);
  const [newSubjectSlashPair, setNewSubjectSlashPair] = useState<string>("");
  const [newSubjectPreferred, setNewSubjectPreferred] = useState<Record<ClassKey, number[]>>({
    jss1: [], jss2: [], jss3: [], ss1: [], ss2: [], ss3: [],
  });
  const [newSubjectDoubles, setNewSubjectDoubles] = useState<Record<ClassKey, number>>({ ...EMPTY_DOUBLES });
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

  const updateSlashPairQuotaMutation = useMutation({
    mutationFn: async (payload: {
      subjectA: string;
      subjectB: string;
      field: QuotaField;
      value: number;
    }) => {
      return apiRequest("PATCH", "/api/quotas/slash-pair", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to update slash pair",
        description: error instanceof Error ? error.message : "Invalid quota value",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
    },
  });

  const createSubjectMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      jss1Quota: number;
      jss2Quota: number;
      jss3Quota: number;
      ss1Quota: number;
      ss2Quota: number;
      ss3Quota: number;
      isSlashSubject: boolean;
      slashPairName: string | null;
      preferredPeriods?: PreferredPeriods;
      requiredDoubles?: RequiredDoubles;
    }) => {
      return apiRequest("POST", "/api/subjects", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subjects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotas"] });
      setSubjectDialogOpen(false);
      resetSubjectForm();
      toast({ title: "Subject Created", description: "New subject has been added" });
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
    setNewSubjectQuotas({ ...EMPTY_QUOTAS });
    setNewSubjectIsSlash(false);
    setNewSubjectSlashPair("");
    setNewSubjectPreferred({ jss1: [], jss2: [], jss3: [], ss1: [], ss2: [], ss3: [] });
    setNewSubjectDoubles({ ...EMPTY_DOUBLES });
    setEditingSubject(null);
  };

  const openAddSubjectDialog = () => {
    resetSubjectForm();
    setSubjectDialogOpen(true);
  };

  const openEditSubjectDialog = (subject: Subject) => {
    setEditingSubject(subject);
    setNewSubjectName(subject.name);
    setNewSubjectQuotas({
      jss1: subject.jss1Quota,
      jss2: subject.jss2Quota,
      jss3: subject.jss3Quota,
      ss1: subject.ss1Quota,
      ss2: subject.ss2Quota,
      ss3: subject.ss3Quota,
    });
    setNewSubjectIsSlash(subject.isSlashSubject);
    setNewSubjectSlashPair(subject.slashPairName || "");
    setNewSubjectPreferred({
      jss1: subject.preferredPeriods?.jss1 ?? [],
      jss2: subject.preferredPeriods?.jss2 ?? [],
      jss3: subject.preferredPeriods?.jss3 ?? [],
      ss1: subject.preferredPeriods?.ss1 ?? [],
      ss2: subject.preferredPeriods?.ss2 ?? [],
      ss3: subject.preferredPeriods?.ss3 ?? [],
    });
    setNewSubjectDoubles({
      jss1: subject.requiredDoubles?.jss1 ?? 0,
      jss2: subject.requiredDoubles?.jss2 ?? 0,
      jss3: subject.requiredDoubles?.jss3 ?? 0,
      ss1: subject.requiredDoubles?.ss1 ?? 0,
      ss2: subject.requiredDoubles?.ss2 ?? 0,
      ss3: subject.requiredDoubles?.ss3 ?? 0,
    });
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
    const preferredPeriods: PreferredPeriods = {
      jss1: [...newSubjectPreferred.jss1].sort((a, b) => a - b),
      jss2: [...newSubjectPreferred.jss2].sort((a, b) => a - b),
      jss3: [...newSubjectPreferred.jss3].sort((a, b) => a - b),
      ss1: [...newSubjectPreferred.ss1].sort((a, b) => a - b),
      ss2: [...newSubjectPreferred.ss2].sort((a, b) => a - b),
      ss3: [...newSubjectPreferred.ss3].sort((a, b) => a - b),
    };
    const requiredDoubles: RequiredDoubles = { ...newSubjectDoubles };
    const quotaPayload = {
      jss1Quota: newSubjectQuotas.jss1,
      jss2Quota: newSubjectQuotas.jss2,
      jss3Quota: newSubjectQuotas.jss3,
      ss1Quota: newSubjectQuotas.ss1,
      ss2Quota: newSubjectQuotas.ss2,
      ss3Quota: newSubjectQuotas.ss3,
    };
    if (editingSubject) {
      updateSubjectMutation.mutate({
        id: editingSubject.id,
        updates: {
          name: newSubjectName,
          ...quotaPayload,
          isSlashSubject: isSlash,
          slashPairName: pairName,
          preferredPeriods,
          requiredDoubles,
        },
      });
    } else {
      createSubjectMutation.mutate({
        name: newSubjectName,
        ...quotaPayload,
        isSlashSubject: isSlash,
        slashPairName: pairName,
        preferredPeriods,
        requiredDoubles,
      });
    }
  };

  // Helpers for the per-class Settings UI.
  function quotaSum(q: SubjectQuota | Subject): number {
    return q.jss1Quota + q.jss2Quota + q.jss3Quota + q.ss1Quota + q.ss2Quota + q.ss3Quota;
  }
  function classTotal(cls: SchoolClass): number {
    const field = quotaFieldForClass(cls);
    return quotas.reduce((sum, q) => sum + q[field], 0);
  }

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
                  Custom Subjects
                </CardTitle>
                <CardDescription>
                  Create and manage custom subjects for your timetable
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
                No subjects yet. Click "Add Subject" to create one.
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
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                        <span>JSS1: {subject.jss1Quota}</span>
                        <span>JSS2: {subject.jss2Quota}</span>
                        <span>JSS3: {subject.jss3Quota}</span>
                        <span>SS1: {subject.ss1Quota}</span>
                        <span>SS2: {subject.ss2Quota}</span>
                        <span>SS3: {subject.ss3Quota}</span>
                        <span className="font-medium text-foreground">Total: {quotaSum(subject)}</span>
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
                {editingSubject ? "Update the subject details below" : "Create a new subject with weekly period quotas"}
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
              <div>
                <Label className="text-sm font-medium">Periods per week (per class)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Set how many periods this subject should run in each class.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {CLASS_KEYS.map((k) => (
                    <div key={k} className="space-y-1">
                      <Label htmlFor={`quota-${k}`} className="text-xs text-muted-foreground">
                        {CLASS_LABELS[k]}
                      </Label>
                      <NumberInput
                        id={`quota-${k}`}
                        min={0}
                        max={10}
                        value={newSubjectQuotas[k]}
                        onChange={(v) => setNewSubjectQuotas((prev) => ({ ...prev, [k]: v }))}
                        data-testid={`input-quota-${k}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-muted/50 rounded-md p-3 mt-2">
                <p className="text-sm font-medium">
                  Total Weekly Periods: {CLASS_KEYS.reduce((sum, k) => sum + newSubjectQuotas[k], 0)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Sum across JSS1, JSS2, JSS3, SS1, SS2 and SS3
                </p>
              </div>

              <div className="space-y-4 border-t pt-4">
                <div>
                  <Label className="text-sm font-medium">Preferred periods</Label>
                  <p className="text-xs text-muted-foreground">
                    Pick the periods this subject should land in first. Leave empty to allow any period.
                  </p>
                </div>
                {CLASS_KEYS.map((k) => {
                  const value = newSubjectPreferred[k];
                  return (
                    <div key={k} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{CLASS_LABELS[k]}</Label>
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
                                setNewSubjectPreferred((prev) => ({
                                  ...prev,
                                  [k]: on ? prev[k].filter((x) => x !== p) : [...prev[k], p],
                                }))
                              }
                              data-testid={`chip-pref-${k}-${p}`}
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
                <div>
                  <Label className="text-sm font-medium">Required doubles per week</Label>
                  <p className="text-xs text-muted-foreground">
                    Number of double-period blocks the generator must place per class.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {CLASS_KEYS.map((k) => (
                    <div key={k} className="space-y-1">
                      <Label htmlFor={`doubles-${k}`} className="text-xs text-muted-foreground">
                        {CLASS_LABELS[k]}
                      </Label>
                      <NumberInput
                        id={`doubles-${k}`}
                        min={0}
                        max={4}
                        value={newSubjectDoubles[k]}
                        onChange={(v) => setNewSubjectDoubles((prev) => ({ ...prev, [k]: v }))}
                        data-testid={`input-doubles-${k}`}
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
                      if (!v) setNewSubjectSlashPair("");
                    }}
                    data-testid="switch-subject-slash"
                  />
                </div>
                {newSubjectIsSlash && (
                  <div className="space-y-2">
                    <Label htmlFor="subject-slash-pair">Pairs with</Label>
                    <Select
                      value={newSubjectSlashPair}
                      onValueChange={setNewSubjectSlashPair}
                    >
                      <SelectTrigger id="subject-slash-pair" data-testid="select-subject-slash-pair">
                        <SelectValue placeholder="Choose the partner subject" />
                      </SelectTrigger>
                      <SelectContent>
                        {slashPairCandidates.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">
                            No other subjects available — create one first.
                          </div>
                        ) : (
                          slashPairCandidates.map((s) => (
                            <SelectItem key={s.id} value={s.name}>
                              {s.name}
                              {s.isSlashSubject && s.slashPairName && s.slashPairName !== newSubjectName && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  (currently paired with {s.slashPairName})
                                </span>
                              )}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Saving will mirror this pairing on the partner. Any prior pairing the partner had will be cleared.
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
                disabled={!newSubjectName.trim() || createSubjectMutation.isPending || updateSubjectMutation.isPending}
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
                        // Per-class totals. For SS2/SS3 each slash pair occupies
                        // one slot but counts toward both partners' quotas — we
                        // count each side once and de-dupe pairs to match the
                        // actual number of timetable slots used.
                        const seenPairs = new Set<string>();
                        const countedSlashNames = new Set<string>();
                        for (const s of subjects) {
                          if (!s.isSlashSubject) continue;
                          const partner = findSlashPair(subjects, s.name);
                          if (!partner) continue;
                          const key = [s.name, partner.name].sort().join("|");
                          if (seenPairs.has(key)) continue;
                          seenPairs.add(key);
                          countedSlashNames.add(s.name <= partner.name ? s.name : partner.name);
                        }
                        const slashNames = new Set(
                          subjects.filter((s) => s.isSlashSubject && findSlashPair(subjects, s.name)).map((s) => s.name),
                        );
                        const totalForClass = (cls: SchoolClass): number => {
                          const field = quotaFieldForClass(cls);
                          if (cls === "SS2" || cls === "SS3") {
                            const slashTotal = quotas
                              .filter((q) => countedSlashNames.has(q.subject))
                              .reduce((sum, q) => sum + q[field], 0);
                            const regularTotal = quotas
                              .filter((q) => q[field] > 0 && !slashNames.has(q.subject))
                              .reduce((sum, q) => sum + q[field], 0);
                            return slashTotal + regularTotal;
                          }
                          return quotas.reduce((sum, q) => sum + q[field], 0);
                        };
                        return (
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {CLASSES.map((cls) => {
                                const total = totalForClass(cls);
                                const inRange = total >= 37 && total <= 40;
                                const cls2 = total > 40 ? 'text-destructive' : inRange ? 'text-green-600' : 'text-amber-600';
                                return (
                                  <span key={cls} className={`text-sm ${cls2}`}>
                                    {cls}: {total}/40
                                  </span>
                                );
                              })}
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

                {CLASSES.map((cls) => {
                  const field = quotaFieldForClass(cls);
                  const isSlashClass = cls === "SS2" || cls === "SS3";

                  // Build slash pair list (only relevant for SS2/SS3).
                  const seenPairs = new Set<string>();
                  const allPairs: Array<{ a: string; b: string }> = [];
                  const slashNamesForBadge = new Set<string>();
                  for (const s of subjects) {
                    if (!s.isSlashSubject) continue;
                    const partner = findSlashPair(subjects, s.name);
                    if (!partner) continue;
                    slashNamesForBadge.add(s.name);
                    const key = [s.name, partner.name].sort().join("|");
                    if (seenPairs.has(key)) continue;
                    seenPairs.add(key);
                    const [a, b] = [s.name, partner.name].sort();
                    allPairs.push({ a, b });
                  }
                  const pairs = isSlashClass
                    ? allPairs.filter(({ a, b }) => {
                        const qa = quotas.find((q) => q.subject === a);
                        const qb = quotas.find((q) => q.subject === b);
                        return Math.max(qa?.[field] ?? 0, qb?.[field] ?? 0) > 0;
                      })
                    : [];
                  const slashTotal = pairs.reduce((sum, p) => {
                    const qa = quotas.find((q) => q.subject === p.a);
                    const qb = quotas.find((q) => q.subject === p.b);
                    return sum + Math.max(qa?.[field] ?? 0, qb?.[field] ?? 0);
                  }, 0);

                  const regularSubjects = [...quotas]
                    .filter((q) => q[field] > 0 && (!isSlashClass || !slashNamesForBadge.has(q.subject)))
                    .sort((a, b) => a.subject.localeCompare(b.subject));
                  const regularTotal = regularSubjects.reduce((sum, q) => sum + q[field], 0);
                  const perClass = slashTotal + regularTotal;

                  return (
                    <div key={cls}>
                      <Separator className="mb-6" />
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium">
                          {cls} Subjects{isSlashClass && pairs.length > 0 ? " (includes slash pairing)" : ""}
                        </h3>
                        <Badge variant="secondary">{perClass} periods/class</Badge>
                      </div>

                      {pairs.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm text-muted-foreground mb-3">Slash Subject Pairs (scheduled simultaneously)</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {pairs.map(({ a, b }) => {
                              const qa = quotas.find((q) => q.subject === a);
                              const qb = quotas.find((q) => q.subject === b);
                              const quota = Math.max(qa?.[field] ?? 0, qb?.[field] ?? 0);
                              return (
                                <div key={`${a}-${b}`} className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <Label className="text-sm flex items-center gap-1">
                                      {a} / {b}
                                      <Badge variant="outline" className="text-xs ml-1">Slash</Badge>
                                    </Label>
                                  </div>
                                  <NumberInput
                                    min={0}
                                    max={10}
                                    value={quota}
                                    onChange={(v) => {
                                      updateSlashPairQuotaMutation.mutate({
                                        subjectA: a,
                                        subjectB: b,
                                        field,
                                        value: v,
                                      });
                                    }}
                                    className="w-16"
                                    data-testid={`input-quota-slash-${cls.toLowerCase()}-${a.toLowerCase()}-${b.toLowerCase()}`}
                                  />
                                  <span className="text-sm text-muted-foreground">per week</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {regularSubjects.length > 0 ? (
                        <>
                          {pairs.length > 0 && (
                            <p className="text-sm text-muted-foreground mb-3">Regular Subjects</p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {regularSubjects.map((q) => (
                              <QuotaInput
                                key={q.subject}
                                subject={q.subject}
                                value={q[field]}
                                onChange={(v) => handleQuotaChange(q.subject, field, v)}
                                isSlash={q.isSlashSubject}
                                sectionTotal={q[field]}
                              />
                            ))}
                          </div>
                        </>
                      ) : pairs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No subjects assigned to {cls} yet.</p>
                      ) : null}
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
  sectionTotal
}: { 
  subject: string; 
  value: number; 
  onChange: (value: number) => void;
  isSlash: boolean;
  sectionTotal: number;
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
        data-testid={`input-quota-${subject.toLowerCase().replace(/\s+/g, "-")}`}
      />
      <span className="text-sm text-muted-foreground">per week</span>
    </div>
  );
}
