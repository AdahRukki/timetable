import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SavedTimetable } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Save, Upload, Pencil, Trash2, Loader2, Calendar } from "lucide-react";

export default function SavedTimetablesPage() {
  const { toast } = useToast();
  const [renameTarget, setRenameTarget] = useState<SavedTimetable | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadTarget, setLoadTarget] = useState<SavedTimetable | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedTimetable | null>(null);

  const { data: items = [], isLoading } = useQuery<SavedTimetable[]>({
    queryKey: ["/api/saved-timetables"],
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/saved-timetables/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-timetables"] });
      toast({ title: "Renamed", description: "Saved timetable renamed." });
      setRenameTarget(null);
    },
    onError: () => {
      toast({ title: "Rename failed", description: "Could not rename.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/saved-timetables/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-timetables"] });
      toast({ title: "Deleted", description: "Saved timetable removed." });
      setDeleteTarget(null);
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete.", variant: "destructive" });
    },
  });

  const loadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/saved-timetables/${id}/load`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timetable"] });
      queryClient.invalidateQueries({ queryKey: ["/api/actions"] });
      toast({
        title: "Timetable loaded",
        description: "The saved timetable is now your live grid.",
      });
      setLoadTarget(null);
    },
    onError: () => {
      toast({ title: "Load failed", description: "Could not load.", variant: "destructive" });
    },
  });

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Saved Timetables</h1>
        <p className="text-sm text-muted-foreground">
          Load a previous snapshot back into your live grid, or rename and delete entries you no
          longer need.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Save className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No saved timetables yet</p>
            <p className="text-sm mt-1">
              Use the "Save Timetable" button on the Timetable page to keep a snapshot here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const slotCount = item.timetableData?.length ?? 0;
            return (
              <Card key={item.id} data-testid={`card-saved-${item.id}`}>
                <CardHeader>
                  <CardTitle
                    className="text-base truncate"
                    data-testid={`text-saved-name-${item.id}`}
                  >
                    {item.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{formatDate(item.createdAt)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {slotCount} scheduled period{slotCount === 1 ? "" : "s"}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      size="sm"
                      onClick={() => setLoadTarget(item)}
                      data-testid={`button-load-${item.id}`}
                    >
                      <Upload className="h-4 w-4 mr-1.5" /> Load
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRenameTarget(item);
                        setRenameValue(item.name);
                      }}
                      data-testid={`button-rename-${item.id}`}
                    >
                      <Pencil className="h-4 w-4 mr-1.5" /> Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleteTarget(item)}
                      data-testid={`button-delete-${item.id}`}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Saved Timetable</DialogTitle>
            <DialogDescription>Choose a new name for this snapshot.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-input">Name</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              data-testid="input-rename-saved"
              maxLength={100}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renameValue.trim() || renameMutation.isPending}
              onClick={() =>
                renameTarget &&
                renameMutation.mutate({ id: renameTarget.id, name: renameValue.trim() })
              }
              data-testid="button-confirm-rename"
            >
              {renameMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load confirmation */}
      <AlertDialog open={!!loadTarget} onOpenChange={(o) => !o && setLoadTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load this timetable?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace your current live timetable with "{loadTarget?.name}". Your
              undo/redo history will be cleared. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => loadTarget && loadMutation.mutate(loadTarget.id)}
              data-testid="button-confirm-load"
            >
              {loadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Load
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved timetable?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
