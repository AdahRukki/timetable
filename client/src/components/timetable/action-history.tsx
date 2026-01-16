import { type TimetableAction } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { History, Undo2, Redo2, Plus, Minus } from "lucide-react";
import { format } from "date-fns";

interface ActionHistoryProps {
  actions: TimetableAction[];
  currentIndex: number;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function ActionHistory({
  actions,
  currentIndex,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ActionHistoryProps) {
  const visibleActions = actions.slice(0, currentIndex + 1).reverse();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">History</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onUndo}
              disabled={!canUndo}
              data-testid="button-undo"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRedo}
              disabled={!canRedo}
              data-testid="button-redo"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[150px] px-4 pb-4">
          {visibleActions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
              <History className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No actions yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleActions.map((action, index) => (
                <div
                  key={action.id}
                  className="flex items-start gap-3 p-2 rounded-md bg-muted/30"
                >
                  <div
                    className={`p-1.5 rounded-md ${
                      action.type === "place"
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : "bg-red-500/10 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {action.type === "place" ? (
                      <Plus className="h-3 w-3" />
                    ) : (
                      <Minus className="h-3 w-3" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium truncate">
                        {action.type === "place" ? "Placed" : "Removed"}{" "}
                        {action.slot.subject}
                      </span>
                      {index === 0 && (
                        <Badge variant="outline" className="text-[10px] px-1">
                          Latest
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {action.slot.schoolClass} • {action.slot.day} • P
                      {action.slot.period}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {format(new Date(action.timestamp), "HH:mm:ss")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
