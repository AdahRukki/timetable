import { useState, useMemo, useEffect } from "react";
import {
  type TimetableSlot,
  type Teacher,
  type SchoolClass,
  type SlotType,
  type ValidationResult,
  type Subject,
  findSlashPair,
  PERIODS_PER_DAY,
} from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Trash2,
  BookOpen,
  User,
  Layers,
  Lock,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ACTIVITY_PRESETS = [
  "Assembly",
  "Devotion",
  "Library",
  "Sports",
  "Prep",
  "Lunch",
] as const;

export interface PlacementSubmitOptions {
  isActivity: boolean;
  isLocked: boolean;
  applyToAllClasses: boolean;
}

interface PlacementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: TimetableSlot | null;
  teachers: Teacher[];
  customSubjects: Subject[];
  onPlace: (
    subject: string,
    teacherId: string,
    slotType: SlotType,
    slashPairSubject: string | undefined,
    slashPairTeacherId: string | undefined,
    options: PlacementSubmitOptions,
  ) => void;
  onRemove: () => void;
  validation: ValidationResult | null;
  onValidate: (
    subject: string,
    teacherId: string,
    slotType: SlotType,
    slashPairSubject?: string,
    slashPairTeacherId?: string,
  ) => void;
}

export function PlacementDialog({
  open,
  onOpenChange,
  slot,
  teachers,
  customSubjects,
  onPlace,
  onRemove,
  validation,
  onValidate,
}: PlacementDialogProps) {
  const [subject, setSubject] = useState<string>("");
  const [teacherId, setTeacherId] = useState<string>("");
  const [slotType, setSlotType] = useState<SlotType>("single");
  const [slashPairSubject, setSlashPairSubject] = useState<string>("");
  const [slashPairTeacherId, setSlashPairTeacherId] = useState<string>("");
  const [isActivity, setIsActivity] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [applyToAllClasses, setApplyToAllClasses] = useState(false);

  const isOccupied = slot?.status === "occupied";
  const editingActivity = isOccupied && slot?.slotType === "activity";
  const editingLocked = isOccupied && !!slot?.isLocked;
  const schoolClass = slot?.schoolClass as SchoolClass;
  const selectedSubjectIsSlash = useMemo(
    () => !!subject && !isActivity && !!findSlashPair(customSubjects, subject),
    [subject, customSubjects, isActivity],
  );
  const maxPeriods = slot ? PERIODS_PER_DAY[slot.day] : 9;

  const availableSubjects = useMemo(() => {
    if (!schoolClass) return [];
    return customSubjects
      .filter((s) => {
        if (schoolClass.startsWith("JSS")) {
          return s.jssQuota > 0;
        } else if (schoolClass === "SS1") {
          return s.ss1Quota > 0;
        } else {
          return s.ss2ss3Quota > 0;
        }
      })
      .map((s) => s.name)
      .sort();
  }, [schoolClass, customSubjects]);

  const availableTeachers = useMemo(() => {
    if (!subject || isActivity) return [];
    return teachers.filter(
      (t) =>
        t.subjects.includes(subject) &&
        t.classes.includes(schoolClass)
    );
  }, [subject, teachers, schoolClass, isActivity]);

  const slashPairInfo = useMemo(() => {
    if (slotType !== "slash" || !subject || isActivity) return null;
    const partner = findSlashPair(customSubjects, subject);
    if (!partner) return null;
    return { pairSubject: partner.name };
  }, [slotType, subject, customSubjects, isActivity]);

  const slashPairTeachers = useMemo(() => {
    if (!slashPairInfo?.pairSubject) return [];
    return teachers.filter(
      (t) =>
        t.subjects.includes(slashPairInfo.pairSubject!) &&
        t.classes.includes(schoolClass)
    );
  }, [slashPairInfo, teachers, schoolClass]);

  // Reset form whenever the targeted slot changes (open/close, click new cell).
  useEffect(() => {
    if (isOccupied && slot) {
      const wasActivity = slot.slotType === "activity";
      setIsActivity(wasActivity);
      setIsLocked(!!slot.isLocked);
      setSubject(slot.subject || "");
      setTeacherId(slot.teacherId || "");
      setSlotType(slot.slotType || "single");
      setSlashPairSubject(slot.slashPairSubject || "");
      setSlashPairTeacherId(slot.slashPairTeacherId || "");
      setApplyToAllClasses(false);
    } else {
      setIsActivity(false);
      setIsLocked(false);
      setApplyToAllClasses(false);
      setSubject("");
      setTeacherId("");
      setSlotType("single");
      setSlashPairSubject("");
      setSlashPairTeacherId("");
    }
  }, [slot, isOccupied]);

  // Activities: force slotType, default isLocked on, clear teacher/slash fields.
  useEffect(() => {
    if (isActivity) {
      setSlotType("activity");
      setIsLocked(true);
      setTeacherId("");
      setSlashPairSubject("");
      setSlashPairTeacherId("");
    } else if (slotType === "activity") {
      setSlotType("single");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActivity]);

  // Apply-to-all only makes sense for activities (same teacher can't teach
  // 6 classes at once). Drop the flag if the user toggles activity off.
  useEffect(() => {
    if (!isActivity && applyToAllClasses) setApplyToAllClasses(false);
  }, [isActivity, applyToAllClasses]);

  useEffect(() => {
    if (slashPairInfo?.pairSubject) {
      setSlashPairSubject(slashPairInfo.pairSubject);
    }
  }, [slashPairInfo]);

  useEffect(() => {
    if (isOccupied || isActivity) return;
    if (subject && teacherId) {
      onValidate(
        subject,
        teacherId,
        slotType,
        slotType === "slash" ? slashPairSubject : undefined,
        slotType === "slash" ? slashPairTeacherId : undefined
      );
    }
  }, [subject, teacherId, slotType, slashPairSubject, slashPairTeacherId, isOccupied, isActivity, onValidate]);

  const handlePlace = () => {
    if (isActivity) {
      if (!subject.trim()) return;
      onPlace(
        subject.trim(),
        "",
        "activity",
        undefined,
        undefined,
        { isActivity: true, isLocked: true, applyToAllClasses },
      );
      return;
    }
    if (!subject || !teacherId) return;
    onPlace(
      subject,
      teacherId,
      slotType,
      slotType === "slash" ? slashPairSubject : undefined,
      slotType === "slash" ? slashPairTeacherId : undefined,
      { isActivity: false, isLocked, applyToAllClasses: false },
    );
  };

  const canAllowDouble = slot && slot.period < maxPeriods && slot.period < 8;
  const canAllowSlash = selectedSubjectIsSlash;

  if (!slot) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isOccupied ? "Edit Period" : "Schedule Period"}
            {(isLocked || editingLocked) && (
              <Lock className="h-4 w-4 text-muted-foreground" data-testid="icon-locked-title" />
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Badge variant="outline">{slot.schoolClass}</Badge>
            <span>{slot.day}</span>
            <span>Period {slot.period}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Activity + lock toggles. Hidden when editing existing slot we
              don't currently support flipping the type after the fact. */}
          {!isOccupied && (
            <div className="space-y-3 p-3 rounded-md border bg-muted/30">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="is-activity"
                  checked={isActivity}
                  onCheckedChange={(c) => setIsActivity(c === true)}
                  data-testid="checkbox-is-activity"
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="is-activity" className="font-medium flex items-center gap-2">
                    <CalendarClock className="h-4 w-4" />
                    Non-teaching activity
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Assembly, library, sports, etc. No teacher needed; never
                    moved by auto-generate.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="is-locked"
                  checked={isLocked}
                  disabled={isActivity}
                  onCheckedChange={(c) => setIsLocked(c === true)}
                  data-testid="checkbox-is-locked"
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="is-locked" className="font-medium flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    Lock this period (auto-generate won't change it)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {isActivity
                      ? "Activities are always locked."
                      : "Pin this exact teacher + subject so Clear & Generate keeps it."}
                  </p>
                </div>
              </div>
              {isActivity && (
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="apply-all"
                    checked={applyToAllClasses}
                    onCheckedChange={(c) => setApplyToAllClasses(c === true)}
                    data-testid="checkbox-apply-all-classes"
                  />
                  <div className="grid gap-1 leading-none">
                    <Label htmlFor="apply-all" className="font-medium">
                      Apply to all classes
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Schedule this activity in every class at the same day +
                      period in one click.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {isActivity ? (
            <div className="space-y-2">
              <Label htmlFor="activity-label" className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Activity name
              </Label>
              <Input
                id="activity-label"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Assembly"
                disabled={isOccupied}
                data-testid="input-activity-label"
              />
              {!isOccupied && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ACTIVITY_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setSubject(preset)}
                      className="text-xs px-2 py-1 rounded border hover-elevate"
                      data-testid={`button-preset-${preset.toLowerCase()}`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Subject
                </Label>
                <Select
                  value={subject}
                  onValueChange={(v) => {
                    setSubject(v);
                    setTeacherId("");
                  }}
                  disabled={isOccupied}
                >
                  <SelectTrigger data-testid="select-subject">
                    <SelectValue placeholder="Select a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSubjects.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Teacher
                </Label>
                <Select
                  value={teacherId}
                  onValueChange={setTeacherId}
                  disabled={!subject || isOccupied}
                >
                  <SelectTrigger data-testid="select-teacher">
                    <SelectValue placeholder="Select a teacher" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTeachers.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        No available teachers for this subject
                      </div>
                    ) : (
                      availableTeachers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: t.color }}
                            />
                            {t.name}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Period Type
                </Label>
                <Select
                  value={slotType}
                  onValueChange={(v) => setSlotType(v as SlotType)}
                  disabled={isOccupied}
                >
                  <SelectTrigger data-testid="select-slot-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single Period</SelectItem>
                    {canAllowDouble && (
                      <SelectItem value="double">Double Period</SelectItem>
                    )}
                    {canAllowSlash && (
                      <SelectItem value="slash">Slash Subject</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {slotType === "slash" && slashPairInfo && (
                <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                  <Label className="text-sm text-muted-foreground">
                    Slash Pair: {slashPairInfo.pairSubject}
                  </Label>
                  <Select
                    value={slashPairTeacherId}
                    onValueChange={setSlashPairTeacherId}
                    disabled={isOccupied}
                  >
                    <SelectTrigger data-testid="select-slash-teacher">
                      <SelectValue placeholder="Select teacher for pair subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {slashPairTeachers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: t.color }}
                            />
                            {t.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {validation && (
                <div className="space-y-2">
                  {validation.errors.map((error, i) => (
                    <Alert
                      key={i}
                      variant={error.severity === "error" ? "destructive" : "default"}
                      className={cn(
                        error.severity === "warning" &&
                          "border-amber-500 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-500"
                      )}
                    >
                      {error.severity === "error" ? (
                        <XCircle className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      <AlertDescription>{error.message}</AlertDescription>
                    </Alert>
                  ))}
                  {validation.isValid && validation.errors.length === 0 && (
                    <Alert className="border-green-500 text-green-700 dark:text-green-400 [&>svg]:text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertDescription>
                        Placement is valid
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </>
          )}

          {editingActivity && (
            <Alert>
              <CalendarClock className="h-4 w-4" />
              <AlertDescription className="text-sm">
                This is a fixed activity. Use Remove to free the cell.
              </AlertDescription>
            </Alert>
          )}
          {editingLocked && !editingActivity && (
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription className="text-sm">
                This period is locked. Auto-generate will keep it in place.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          {isOccupied && (
            <Button
              variant="destructive"
              onClick={onRemove}
              className="mr-auto"
              data-testid="button-remove"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!isOccupied && (
            <Button
              onClick={handlePlace}
              disabled={
                isActivity
                  ? !subject.trim()
                  : !subject ||
                    !teacherId ||
                    (validation && !validation.isValid) ||
                    (slotType === "slash" && (!slashPairSubject || !slashPairTeacherId))
              }
              data-testid="button-place"
            >
              {isActivity && applyToAllClasses ? "Schedule for all classes" : "Schedule"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
