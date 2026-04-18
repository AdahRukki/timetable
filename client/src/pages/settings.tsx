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
import { findSlashPair } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useEffect, useMemo } from "react";

export default function SettingsPage() {
  const { toast } = useToast();
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectJssQuota, setNewSubjectJssQuota] = useState(4);
  const [newSubjectSs1Quota, setNewSubjectSs1Quota] = useState(4);
  const [newSubjectSs2ss3Quota, setNewSubjectSs2ss3Quota] = useState(4);
  const [newSubjectIsSlash, setNewSubjectIsSlash] = useState(false);
  const [newSubjectSlashPair, setNewSubjectSlashPair] = useState<string>("");
  const [fatigueLimit, setFatigueLimit] = useState(5);
  const [maxFreePeriodsPerWeek, setMaxFreePeriodsPerWeek] = useState(3);
  const [maxFreePeriodsPerDay, setMaxFreePeriodsPerDay] = useState(2);
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

  const createSubjectMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      jssQuota: number;
      ss1Quota: number;
      ss2ss3Quota: number;
      isSlashSubject: boolean;
      slashPairName: string | null;
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
    setNewSubjectJssQuota(4);
    setNewSubjectSs1Quota(4);
    setNewSubjectSs2ss3Quota(4);
    setNewSubjectIsSlash(false);
    setNewSubjectSlashPair("");
    setEditingSubject(null);
  };

  const openAddSubjectDialog = () => {
    resetSubjectForm();
    setSubjectDialogOpen(true);
  };

  const openEditSubjectDialog = (subject: Subject) => {
    setEditingSubject(subject);
    setNewSubjectName(subject.name);
    setNewSubjectJssQuota(subject.jssQuota);
    setNewSubjectSs1Quota(subject.ss1Quota);
    setNewSubjectSs2ss3Quota(subject.ss2ss3Quota);
    setNewSubjectIsSlash(subject.isSlashSubject);
    setNewSubjectSlashPair(subject.slashPairName || "");
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
    if (editingSubject) {
      updateSubjectMutation.mutate({
        id: editingSubject.id,
        updates: {
          name: newSubjectName,
          jssQuota: newSubjectJssQuota,
          ss1Quota: newSubjectSs1Quota,
          ss2ss3Quota: newSubjectSs2ss3Quota,
          isSlashSubject: isSlash,
          slashPairName: pairName,
        },
      });
    } else {
      createSubjectMutation.mutate({
        name: newSubjectName,
        jssQuota: newSubjectJssQuota,
        ss1Quota: newSubjectSs1Quota,
        ss2ss3Quota: newSubjectSs2ss3Quota,
        isSlashSubject: isSlash,
        slashPairName: pairName,
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
                        <span>JSS: {subject.jssQuota}</span>
                        <span>SS1: {subject.ss1Quota}</span>
                        <span>SS2/SS3: {subject.ss2ss3Quota}</span>
                        <span className="font-medium text-foreground">Total: {(subject.jssQuota * 3) + subject.ss1Quota + (subject.ss2ss3Quota * 2)}</span>
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
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jss-quota">JSS Quota</Label>
                  <Input
                    id="jss-quota"
                    type="number"
                    min={0}
                    max={10}
                    value={newSubjectJssQuota}
                    onChange={(e) => setNewSubjectJssQuota(parseInt(e.target.value) || 0)}
                    data-testid="input-jss-quota"
                  />
                  <p className="text-xs text-muted-foreground">× 3 classes = {newSubjectJssQuota * 3}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ss1-quota">SS1 Quota</Label>
                  <Input
                    id="ss1-quota"
                    type="number"
                    min={0}
                    max={10}
                    value={newSubjectSs1Quota}
                    onChange={(e) => setNewSubjectSs1Quota(parseInt(e.target.value) || 0)}
                    data-testid="input-ss1-quota"
                  />
                  <p className="text-xs text-muted-foreground">× 1 class = {newSubjectSs1Quota}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ss2ss3-quota">SS2/SS3 Quota</Label>
                  <Input
                    id="ss2ss3-quota"
                    type="number"
                    min={0}
                    max={10}
                    value={newSubjectSs2ss3Quota}
                    onChange={(e) => setNewSubjectSs2ss3Quota(parseInt(e.target.value) || 0)}
                    data-testid="input-ss2ss3-quota"
                  />
                  <p className="text-xs text-muted-foreground">× 2 classes = {newSubjectSs2ss3Quota * 2}</p>
                </div>
              </div>
              <div className="bg-muted/50 rounded-md p-3 mt-2">
                <p className="text-sm font-medium">
                  Total Weekly Periods: {(newSubjectJssQuota * 3) + newSubjectSs1Quota + (newSubjectSs2ss3Quota * 2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  JSS ({newSubjectJssQuota} × 3) + SS1 ({newSubjectSs1Quota} × 1) + SS2/SS3 ({newSubjectSs2ss3Quota} × 2)
                </p>
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
                        // For SS2/SS3 totals, slash pairs share a single timetable
                        // slot, so each pair counts once (not twice). We pick one
                        // canonical side per pair (alphabetically first) to count.
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
                        const jssTotal = quotas.reduce((sum, q) => sum + q.jssQuota, 0);
                        const ss1Total = quotas.reduce((sum, q) => sum + q.ss1Quota, 0);
                        const ss2ss3SlashTotal = quotas
                          .filter((q) => countedSlashNames.has(q.subject))
                          .reduce((sum, q) => sum + q.ss2ss3Quota, 0);
                        const ss2ss3RegularTotal = quotas
                          .filter((q) => q.ss2ss3Quota > 0 && !slashNames.has(q.subject))
                          .reduce((sum, q) => sum + q.ss2ss3Quota, 0);
                        const ss2ss3Total = ss2ss3SlashTotal + ss2ss3RegularTotal;
                        
                        const jssInRange = jssTotal >= 37 && jssTotal <= 40;
                        const ss1InRange = ss1Total >= 37 && ss1Total <= 40;
                        const ss2ss3InRange = ss2ss3Total >= 37 && ss2ss3Total <= 40;
                        
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center justify-end gap-2">
                              <span className={`text-sm ${jssInRange ? 'text-green-600' : jssTotal > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                JSS: {jssTotal}/40
                              </span>
                              <span className={`text-sm ${ss1InRange ? 'text-green-600' : ss1Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                SS1: {ss1Total}/40
                              </span>
                              <span className={`text-sm ${ss2ss3InRange ? 'text-green-600' : ss2ss3Total > 40 ? 'text-destructive' : 'text-amber-600'}`}>
                                SS2/SS3: {ss2ss3Total}/40
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

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">JSS Subjects (JSS1-JSS3)</h3>
                    <Badge variant="secondary">
                      {quotas.reduce((sum, q) => sum + q.jssQuota, 0)} periods/class ({quotas.reduce((sum, q) => sum + q.jssQuota, 0) * 3} total for 3 classes)
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {quotas.filter(q => q.jssQuota > 0).map((q) => (
                      <QuotaInput
                        key={q.subject}
                        subject={q.subject}
                        value={q.jssQuota}
                        onChange={(v) => handleQuotaChange(q.subject, "jssQuota", v)}
                        isSlash={q.isSlashSubject}
                        sectionTotal={q.jssQuota * 3}
                      />
                    ))}
                  </div>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium">SS1 Subjects</h3>
                    <Badge variant="secondary">
                      {quotas.reduce((sum, q) => sum + q.ss1Quota, 0)} periods/class
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {quotas.filter(q => q.ss1Quota > 0).map((q) => (
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

                <div>
                  {(() => {
                    // Derive slash pairs from the user's own subjects.
                    const seenPairs = new Set<string>();
                    const pairs: Array<{ a: string; b: string }> = [];
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
                      pairs.push({ a, b });
                    }
                    const slashTotal = pairs.reduce((sum, p) => {
                      const q = quotas.find((q) => q.subject === p.a);
                      return sum + (q?.ss2ss3Quota || 0);
                    }, 0);
                    const regularTotal = quotas
                      .filter((q) => q.ss2ss3Quota > 0 && !slashNamesForBadge.has(q.subject))
                      .reduce((sum, q) => sum + q.ss2ss3Quota, 0);
                    const perClass = slashTotal + regularTotal;

                    return (
                      <>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-medium">SS2/SS3 Subjects (includes slash pairing)</h3>
                          <Badge variant="secondary">
                            {`${perClass} periods/class (${perClass * 2} total for 2 classes)`}
                          </Badge>
                        </div>

                        {pairs.length > 0 && (
                          <div className="mb-4">
                            <p className="text-sm text-muted-foreground mb-3">Slash Subject Pairs (scheduled simultaneously)</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                              {pairs.map(({ a, b }) => {
                                const q = quotas.find((q) => q.subject === a);
                                const quota = q?.ss2ss3Quota || 0;
                                return (
                                  <div key={`${a}-${b}`} className="flex items-center gap-2">
                                    <div className="flex-1">
                                      <Label className="text-sm flex items-center gap-1">
                                        {a} / {b}
                                        <Badge variant="outline" className="text-xs ml-1">Slash</Badge>
                                        <span className="text-xs text-muted-foreground ml-1">({quota * 2} total)</span>
                                      </Label>
                                    </div>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={10}
                                      value={quota}
                                      onChange={(e) => {
                                        const v = Math.max(0, Math.min(10, parseInt(e.target.value) || 0));
                                        handleQuotaChange(a, "ss2ss3Quota", v);
                                        handleQuotaChange(b, "ss2ss3Quota", v);
                                      }}
                                      className="w-16 text-center"
                                      data-testid={`input-quota-slash-${a.toLowerCase()}-${b.toLowerCase()}`}
                                    />
                                    <span className="text-sm text-muted-foreground">per week</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <p className="text-sm text-muted-foreground mb-3">Regular Subjects</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {quotas
                            .filter((q) => q.ss2ss3Quota > 0 && !slashNamesForBadge.has(q.subject))
                            .map((q) => (
                              <QuotaInput
                                key={q.subject}
                                subject={q.subject}
                                value={q.ss2ss3Quota}
                                onChange={(v) => handleQuotaChange(q.subject, "ss2ss3Quota", v)}
                                isSlash={false}
                                sectionTotal={q.ss2ss3Quota * 2}
                              />
                            ))}
                        </div>
                      </>
                    );
                  })()}
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5 flex-1">
                <Label>Teacher Fatigue Limit</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum consecutive teaching periods allowed per teacher per day (1-10)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={fatigueLimit}
                  onChange={(e) => setFatigueLimit(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5 flex-1">
                <Label>Max Free Periods Per Week</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum free periods allowed per class per week (0-10)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={maxFreePeriodsPerWeek}
                  onChange={(e) => setMaxFreePeriodsPerWeek(Math.min(10, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="w-20"
                  data-testid="input-max-free-week"
                />
                <Button
                  size="sm"
                  onClick={() => updateSettingsMutation.mutate({ maxFreePeriodsPerWeek })}
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
            <Separator />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-0.5 flex-1">
                <Label>Max Free Periods Per Day</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum free periods allowed per class per day (0-5)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={5}
                  value={maxFreePeriodsPerDay}
                  onChange={(e) => setMaxFreePeriodsPerDay(Math.min(5, Math.max(0, parseInt(e.target.value) || 0)))}
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
          <span className="text-xs text-muted-foreground ml-1">({sectionTotal} total)</span>
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
