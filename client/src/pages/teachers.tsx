import { useState } from "react";
import { type Teacher, DAYS, CLASSES, type Day, type SchoolClass } from "@shared/schema";
import { sampleTeachers } from "@/lib/sample-data";
import { getTeacherColor } from "@/lib/timetable-utils";
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
import { Users, Plus, Search, BookOpen, GraduationCap, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function TeachersPage() {
  const { toast } = useToast();
  const [teachers, setTeachers] = useState<Teacher[]>(sampleTeachers);
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const [newTeacherName, setNewTeacherName] = useState("");
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedClasses, setSelectedClasses] = useState<SchoolClass[]>([]);

  const filteredTeachers = teachers.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.subjects.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const allSubjects = Array.from(
    new Set(teachers.flatMap((t) => t.subjects))
  ).sort();

  const handleAddTeacher = () => {
    if (!newTeacherName.trim() || selectedSubjects.length === 0 || selectedClasses.length === 0) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const newTeacher: Teacher = {
      id: `T${teachers.length + 1}`,
      name: newTeacherName.trim(),
      subjects: selectedSubjects,
      classes: selectedClasses,
      unavailable: {},
      color: getTeacherColor(teachers.length),
    };

    setTeachers([...teachers, newTeacher]);
    setDialogOpen(false);
    setNewTeacherName("");
    setSelectedSubjects([]);
    setSelectedClasses([]);

    toast({
      title: "Teacher added",
      description: `${newTeacher.name} has been added successfully`,
    });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
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
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-teacher">
              <Plus className="h-4 w-4 mr-2" />
              Add Teacher
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Teacher</DialogTitle>
              <DialogDescription>
                Enter the teacher's details and assign subjects
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Mr. Johnson"
                  value={newTeacherName}
                  onChange={(e) => setNewTeacherName(e.target.value)}
                  data-testid="input-teacher-name"
                />
              </div>

              <div className="space-y-2">
                <Label>Subjects</Label>
                <ScrollArea className="h-32 border rounded-md p-2">
                  <div className="space-y-2">
                    {allSubjects.map((subject) => (
                      <div key={subject} className="flex items-center gap-2">
                        <Checkbox
                          id={`subject-${subject}`}
                          checked={selectedSubjects.includes(subject)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedSubjects([...selectedSubjects, subject]);
                            } else {
                              setSelectedSubjects(
                                selectedSubjects.filter((s) => s !== subject)
                              );
                            }
                          }}
                        />
                        <Label
                          htmlFor={`subject-${subject}`}
                          className="text-sm font-normal cursor-pointer"
                        >
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
                      variant={selectedClasses.includes(cls) ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        if (selectedClasses.includes(cls)) {
                          setSelectedClasses(selectedClasses.filter((c) => c !== cls));
                        } else {
                          setSelectedClasses([...selectedClasses, cls]);
                        }
                      }}
                    >
                      {cls}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddTeacher} data-testid="button-save-teacher">
                Add Teacher
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTeachers.map((teacher) => (
          <Card key={teacher.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                  style={{ backgroundColor: teacher.color }}
                >
                  {teacher.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate">{teacher.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">ID: {teacher.id}</p>
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
                    Unavailable
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
            {searchQuery
              ? "Try adjusting your search"
              : "Add a teacher to get started"}
          </p>
        </div>
      )}
    </div>
  );
}
