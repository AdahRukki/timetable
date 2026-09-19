import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { School as SchoolIcon, Plus, Pencil, Loader2 } from "lucide-react";
import type { School } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SchoolSwitcher() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState("");
  const [renameValue, setRenameValue] = useState("");

  const { data: schools = [], isLoading } = useQuery<School[]>({
    queryKey: ["/api/schools"],
  });

  const activeSchool = useMemo(
    () => schools.find((school) => school.isActive) ?? schools[0],
    [schools],
  );

  const reloadWorkspace = () => {
    // A full reload intentionally clears component-local timetable state as
    // well as React Query caches, preventing stale data from the previous
    // school being edited after the server has switched workspaces.
    window.location.reload();
  };

  const switchMutation = useMutation({
    mutationFn: async (schoolId: string) => {
      const response = await apiRequest("POST", `/api/schools/${schoolId}/activate`);
      return response.json() as Promise<School>;
    },
    onSuccess: () => {
      reloadWorkspace();
    },
    onError: (error) => {
      toast({
        title: "Could not switch school",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await apiRequest("POST", "/api/schools", { name });
      return response.json() as Promise<School>;
    },
    onSuccess: () => {
      setCreateOpen(false);
      setNewSchoolName("");
      reloadWorkspace();
    },
    onError: (error) => {
      toast({
        title: "Could not create school",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const response = await apiRequest("PATCH", `/api/schools/${id}`, { name });
      return response.json() as Promise<School>;
    },
    onSuccess: async (school) => {
      setRenameOpen(false);
      setRenameValue("");
      await queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
      toast({
        title: "School renamed",
        description: `School name changed to ${school.name}.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Could not rename school",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const openRename = () => {
    if (!activeSchool) return;
    setRenameValue(activeSchool.name);
    setRenameOpen(true);
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Current School</Label>
        <div className="flex items-center gap-1.5">
          <Select
            value={activeSchool?.id ?? ""}
            onValueChange={(schoolId) => {
              if (schoolId && schoolId !== activeSchool?.id) {
                switchMutation.mutate(schoolId);
              }
            }}
            disabled={isLoading || switchMutation.isPending || schools.length === 0}
          >
            <SelectTrigger className="min-w-0 flex-1 h-9" data-testid="select-school">
              <div className="flex items-center gap-2 min-w-0">
                {switchMutation.isPending ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <SchoolIcon className="h-4 w-4 shrink-0" />
                )}
                <SelectValue placeholder={isLoading ? "Loading schools..." : "Select school"} />
              </div>
            </SelectTrigger>
            <SelectContent>
              {schools.map((school) => (
                <SelectItem key={school.id} value={school.id}>
                  {school.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={openRename}
            disabled={!activeSchool}
            title="Edit school name"
            data-testid="button-rename-school"
          >
            <Pencil className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setCreateOpen(true)}
            title="Create new school"
            data-testid="button-create-school"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New School</DialogTitle>
            <DialogDescription>
              This creates a separate timetable workspace with its own teachers,
              subjects, quotas, settings, timetable and saved versions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-school-name">School name</Label>
            <Input
              id="new-school-name"
              value={newSchoolName}
              onChange={(event) => setNewSchoolName(event.target.value)}
              placeholder="e.g. Seat of Wisdom Academy - Bonsaac"
              maxLength={120}
              data-testid="input-new-school-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(newSchoolName.trim())}
              disabled={!newSchoolName.trim() || createMutation.isPending}
              data-testid="button-confirm-create-school"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create School
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit School Name</DialogTitle>
            <DialogDescription>
              Change the display name of this school. Its timetable data will stay intact.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-school-name">School name</Label>
            <Input
              id="rename-school-name"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={120}
              data-testid="input-rename-school"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                activeSchool &&
                renameMutation.mutate({ id: activeSchool.id, name: renameValue.trim() })
              }
              disabled={!activeSchool || !renameValue.trim() || renameMutation.isPending}
              data-testid="button-confirm-rename-school"
            >
              {renameMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
