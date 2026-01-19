import { useState, useMemo, useEffect } from "react";
import {
  type TimetableSlot,
  type Teacher,
  type SchoolClass,
  type Day,
  type SlotType,
  type ValidationResult,
  getSubjectsForClass,
  usesSlashSubjects,
  SLASH_SUBJECTS,
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
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PlacementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: TimetableSlot | null;
  teachers: Teacher[];
  onPlace: (
    subject: string,
    teacherId: string,
    slotType: SlotType,
    slashPairSubject?: string,
    slashPairTeacherId?: string
  ) => void;
  onRemove: () => void;
  validation: ValidationResult | null;
  onValidate: (
    subject: string,
    teacherId: string,
    slotType: SlotType,
    slashPairSubject?: string,
    slashPairTeacherId?: string
  ) => void;
}

export function PlacementDialog({
  open,
  onOpenChange,
  slot,
  teachers,
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

  const isOccupied = slot?.status === "occupied";
  const schoolClass = slot?.schoolClass as SchoolClass;
  const isSlashClass = schoolClass && usesSlashSubjects(schoolClass);
  const maxPeriods = slot ? PERIODS_PER_DAY[slot.day] : 9;

  const availableSubjects = useMemo(() => {
    if (!schoolClass) return [];
    return Object.keys(getSubjectsForClass(schoolClass));
  }, [schoolClass]);

  const availableTeachers = useMemo(() => {
    if (!subject) return [];
    return teachers.filter(
      (t) =>
        t.subjects.includes(subject) &&
        t.classes.includes(schoolClass)
    );
  }, [subject, teachers, schoolClass]);

  const slashPairInfo = useMemo(() => {
    if (!isSlashClass || slotType !== "slash" || !subject) return null;
    const pair = SLASH_SUBJECTS.find((s) => s.pair.includes(subject));
    if (!pair) return null;
    const pairSubject = pair.pair.find((s) => s !== subject);
    return { pairSubject, periods: pair.periods };
  }, [isSlashClass, slotType, subject]);

  const slashPairTeachers = useMemo(() => {
    if (!slashPairInfo?.pairSubject) return [];
    return teachers.filter(
      (t) =>
        t.subjects.includes(slashPairInfo.pairSubject!) &&
        t.classes.includes(schoolClass)
    );
  }, [slashPairInfo, teachers, schoolClass]);

  useEffect(() => {
    if (isOccupied && slot) {
      setSubject(slot.subject || "");
      setTeacherId(slot.teacherId || "");
      setSlotType(slot.slotType || "single");
      setSlashPairSubject(slot.slashPairSubject || "");
      setSlashPairTeacherId(slot.slashPairTeacherId || "");
    } else {
      setSubject("");
      setTeacherId("");
      setSlotType("single");
      setSlashPairSubject("");
      setSlashPairTeacherId("");
    }
  }, [slot, isOccupied]);

  useEffect(() => {
    if (slashPairInfo?.pairSubject) {
      setSlashPairSubject(slashPairInfo.pairSubject);
    }
  }, [slashPairInfo]);

  useEffect(() => {
    if (subject && teacherId && !isOccupied) {
      onValidate(
        subject,
        teacherId,
        slotType,
        slotType === "slash" ? slashPairSubject : undefined,
        slotType === "slash" ? slashPairTeacherId : undefined
      );
    }
  }, [subject, teacherId, slotType, slashPairSubject, slashPairTeacherId, isOccupied, onValidate]);

  const handlePlace = () => {
    if (!subject || !teacherId) return;
    onPlace(
      subject,
      teacherId,
      slotType,
      slotType === "slash" ? slashPairSubject : undefined,
      slotType === "slash" ? slashPairTeacherId : undefined
    );
  };

  const canAllowDouble = slot && slot.period < maxPeriods && slot.period < 8;
  const canAllowSlash = isSlashClass;

  if (!slot) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isOccupied ? "Edit Period" : "Schedule Period"}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <Badge variant="outline">{slot.schoolClass}</Badge>
            <span>{slot.day}</span>
            <span>Period {slot.period}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
                  <SelectItem value="slash">Slash Subject (SS2/SS3)</SelectItem>
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
                !subject ||
                !teacherId ||
                (validation && !validation.isValid) ||
                (slotType === "slash" && (!slashPairSubject || !slashPairTeacherId))
              }
              data-testid="button-place"
            >
              Schedule
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
