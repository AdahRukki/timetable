import { type TimetableSlot, type Teacher } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Coffee, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TimetableCellProps {
  slot: TimetableSlot;
  teacher?: Teacher;
  slashPairTeacher?: Teacher;
  onCellClick: () => void;
  isDouble?: boolean;
  isSecondOfDouble?: boolean;
}

export function TimetableCell({
  slot,
  teacher,
  slashPairTeacher,
  onCellClick,
  isDouble,
  isSecondOfDouble,
}: TimetableCellProps) {
  if (isSecondOfDouble) {
    return null;
  }

  if (slot.status === "break") {
    return (
      <div className="timetable-cell timetable-cell-break h-14 flex items-center justify-center rounded-md">
        <Coffee className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  if (slot.status === "empty") {
    return (
      <button
        onClick={onCellClick}
        className="timetable-cell timetable-cell-empty h-14 w-full flex items-center justify-center rounded-md hover-elevate cursor-pointer group"
        data-testid={`cell-empty-${slot.day}-${slot.schoolClass}-${slot.period}`}
      >
        <Plus className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  const cellStyle = teacher
    ? { backgroundColor: `${teacher.color}15`, borderColor: teacher.color }
    : {};

  const content = (
    <button
      onClick={onCellClick}
      className={cn(
        "timetable-cell timetable-cell-occupied w-full flex flex-col items-start justify-center rounded-md px-2 py-1 hover-elevate cursor-pointer text-left border-l-4",
        isDouble ? "h-[7.25rem]" : "h-14"
      )}
      style={cellStyle}
      data-testid={`cell-${slot.day}-${slot.schoolClass}-${slot.period}`}
    >
      {slot.slotType === "slash" ? (
        <>
          <div className="flex items-center gap-1 w-full">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: teacher?.color }}
            />
            <span className="text-xs font-medium truncate">{slot.subject}</span>
          </div>
          <div className="flex items-center gap-1 w-full">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: slashPairTeacher?.color }}
            />
            <span className="text-xs font-medium truncate">{slot.slashPairSubject}</span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate w-full mt-0.5">
            {teacher?.name?.split(" ")[1]} / {slashPairTeacher?.name?.split(" ")[1]}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1 w-full">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: teacher?.color }}
            />
            <span className="text-xs font-medium truncate">{slot.subject}</span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate w-full">
            {teacher?.name}
          </div>
          {slot.slotType === "double" && (
            <span className="text-[9px] bg-primary/10 text-primary px-1 rounded mt-0.5">
              Double
            </span>
          )}
        </>
      )}
    </button>
  );

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">{slot.subject}</p>
          <p className="text-xs text-muted-foreground">{teacher?.name}</p>
          {slot.slotType === "slash" && (
            <>
              <p className="font-medium mt-1">{slot.slashPairSubject}</p>
              <p className="text-xs text-muted-foreground">{slashPairTeacher?.name}</p>
            </>
          )}
          {slot.slotType === "double" && (
            <p className="text-xs text-primary">Double Period</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
