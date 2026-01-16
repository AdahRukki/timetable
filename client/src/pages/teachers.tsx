import { useState } from "react";
import { type Teacher, DAYS, CLASSES, type Day, type SchoolClass, PERIODS_PER_DAY } from "@shared/schema";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Plus, Search, BookOpen, GraduationCap, Calendar, Edit, Trash2, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ALL_SUBJECTS = [
  "Maths", "English", "Basic Science", "Physics", "Chemistry", "Biology",
  "Social Studies", "Civic", "Basic Technology", "Home Economics",
  "Computer", "PHE", "CRS", "Agric", "Security", "Economics",
  "Marketing", "Government", "Literature",
];

export default function TeachersPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formSubjects, setFormSubjects] = useState<string[]>([]);
  const [formClasses, setFormClasses] = useState<SchoolClass[]>([]);
  const [formUnavailable, setFormUnavailable] = useState<Record<string, number[]>>({});

  const { data: teachers = [], isLoading } = useQuery<Teacher[]>({
    queryKey: ["/api/teachers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; subjects: string[]; classes: SchoolClass[]; unavailable: Record<string, number[]>; color: string }) => {
      return apiRequest("POST", "/api/teachers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teachers"] });
      toast({ title: "Teacher added", description: "Teacher has been added successfully" });
      resetForm();
      setDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add teacher", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Teacher> }) => {
      return apiRequest("PATCH", `/api/teachers/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teachers"] });
      toast({ title: "Teacher updated", description: "Changes saved successfully" });
      resetForm();
      setDialogOpen(false);
      setEditingTeacher(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update teacher", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/teachers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teachers"] });
      toast({ title: "Teacher deleted", description: "Teacher has been removed" });
      setDeleteConfirmId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete teacher", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormSubjects([]);
    setFormClasses([]);
    setFormUnavailable({});
  };

  const openEditDialog = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setFormName(teacher.name);
    setFormSubjects([...teacher.subjects]);
    setFormClasses([...teacher.classes]);
    setFormUnavailable({ ...teacher.unavailable });
    setDialogOpen(true);
  };

  const openAddDialog = () => {
    setEditingTeacher(null);
    resetForm();
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formName.trim() || formSubjects.length === 0 || formClasses.length === 0) {
      toast({
        title: "Missing information",
        description: "Please fill in name, at least one subject, and at least one class",
        variant: "destructive",
      });
      return;
    }

    const cleanedUnavailable: Record<string, number[]> = {};
    for (const [day, periods] of Object.entries(formUnavailable)) {
      if (periods.length > 0) {
        cleanedUnavailable[day] = periods;
      }
    }

    if (editingTeacher) {
      updateMutation.mutate({
        id: editingTeacher.id,
        data: {
          name: formName.trim(),
          subjects: formSubjects,
          classes: formClasses,
          unavailable: cleanedUnavailable,
        },
      });
    } else {
      const colors = ["#8884d8", "#82ca9d", "#ffc658", "#ff7c43", "#a4de6c", "#d0ed57", "#83a6ed", "#8dd1e1"];
      createMutation.mutate({
        name: formName.trim(),
        subjects: formSubjects,
        classes: formClasses,
        unavailable: cleanedUnavailable,
        color: colors[teachers.length % colors.length],
      });
    }
  };

  const toggleUnavailablePeriod = (day: Day, period: number) => {
    setFormUnavailable((prev) => {
      const dayPeriods = prev[day] || [];
      if (dayPeriods.includes(period)) {
        return { ...prev, [day]: dayPeriods.filter((p) => p !== period) };
      } else {
        return { ...prev, [day]: [...dayPeriods, period].sort((a, b) => a - b) };
      }
    });
  };

  const filteredTeachers = teachers.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.subjects.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-6 pb-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Teacher Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage teacher profiles, subjects, and availability
            </p>
          </div>
          <Button onClick={openAddDialog} data-testid="button-add-teacher">
            <Plus className="h-4 w-4 mr-2" />
            Add Teacher
          </Button>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search teachers or subjects..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-teachers"
            />
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-6 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTeachers.map((teacher) => (
            <Card key={teacher.id} className="overflow-hidden" data-testid={`card-teacher-${teacher.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                    style={{ backgroundColor: teacher.color }}
                  >
                    {teacher.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{teacher.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">ID: {teacher.id}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEditDialog(teacher)}
                      data-testid={`button-edit-${teacher.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteConfirmId(teacher.id)}
                      data-testid={`button-delete-${teacher.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
                    <BookOpen className="h-3 w-3" />
                    Subjects
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {teacher.subjects.map((subject) => (
                      <Badge key={subject} variant="secondary" className="text-xs">
                        {subject}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
                    <GraduationCap className="h-3 w-3" />
                    Classes
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {teacher.classes.map((cls) => (
                      <Badge key={cls} variant="outline" className="text-xs">
                        {cls}
                      </Badge>
                    ))}
                  </div>
                </div>

                {Object.entries(teacher.unavailable).length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
                      <Calendar className="h-3 w-3" />
                      Off Periods
                    </div>
                    <div className="space-y-1">
                      {Object.entries(teacher.unavailable).map(
                        ([day, periods]) =>
                          periods.length > 0 && (
                            <div key={day} className="text-xs">
                              <span className="font-medium">{day}:</span>{" "}
                              <span className="text-muted-foreground">
                                P{periods.join(", P")}
                              </span>
                            </div>
                          )
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredTeachers.length === 0 && (
          <div className="text-center py-12">
            <Users className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-4" />
            <h3 className="text-lg font-medium">No teachers found</h3>
            <p className="text-muted-foreground">
              {searchQuery ? "Try adjusting your search" : "Add a teacher to get started"}
            </p>
          </div>
        )}
      </ScrollArea>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingTeacher ? "Edit Teacher" : "Add New Teacher"}</DialogTitle>
            <DialogDescription>
              {editingTeacher ? "Update teacher details and availability" : "Enter the teacher's details and assign subjects"}
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="details" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="availability">Off Days</TabsTrigger>
            </TabsList>
            
            <TabsContent value="details" className="flex-1 overflow-auto space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Mr. Johnson"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  data-testid="input-teacher-name"
                />
              </div>

              <div className="space-y-2">
                <Label>Subjects</Label>
                <ScrollArea className="h-32 border rounded-md p-2">
                  <div className="space-y-2">
                    {ALL_SUBJECTS.map((subject) => (
                      <div key={subject} className="flex items-center gap-2">
                        <Checkbox
                          id={`subject-${subject}`}
                          checked={formSubjects.includes(subject)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setFormSubjects([...formSubjects, subject]);
                            } else {
                              setFormSubjects(formSubjects.filter((s) => s !== subject));
                            }
                          }}
                        />
                        <Label htmlFor={`subject-${subject}`} className="text-sm font-normal cursor-pointer">
                          {subject}
                        </Label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="space-y-2">
                <Label>Classes</Label>
                <div className="flex flex-wrap gap-2">
                  {CLASSES.map((cls) => (
                    <Button
                      key={cls}
                      type="button"
                      variant={formClasses.includes(cls) ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        if (formClasses.includes(cls)) {
                          setFormClasses(formClasses.filter((c) => c !== cls));
                        } else {
                          setFormClasses([...formClasses, cls]);
                        }
                      }}
                    >
                      {cls}
                    </Button>
                  ))}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="availability" className="flex-1 overflow-auto py-4">
              <p className="text-sm text-muted-foreground mb-4">
                Select periods when this teacher is not available to teach (off periods)
              </p>
              <div className="space-y-4">
                {DAYS.map((day) => (
                  <div key={day} className="space-y-2">
                    <Label className="text-sm font-medium">{day}</Label>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: PERIODS_PER_DAY[day] }, (_, i) => i + 1).map((period) => {
                        const isUnavailable = (formUnavailable[day] || []).includes(period);
                        return (
                          <Button
                            key={period}
                            type="button"
                            variant={isUnavailable ? "destructive" : "outline"}
                            size="sm"
                            className="w-10 h-8"
                            onClick={() => toggleUnavailablePeriod(day, period)}
                            data-testid={`toggle-${day}-${period}`}
                          >
                            P{period}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-teacher"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingTeacher ? "Save Changes" : "Add Teacher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Teacher</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this teacher? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
