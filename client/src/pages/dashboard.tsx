import {
  type TimetableSlot,
  type Teacher,
  DAYS,
  CLASSES,
  type Day,
} from "@shared/schema";
import {
  getSlotKey,
  getPeriodsForDay,
  calculateTeacherWorkload,
} from "@/lib/timetable-utils";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  Calendar,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

export default function DashboardPage() {
  // Fetch actual timetable data from API
  const { data: timetableData = [], isLoading: timetableLoading } = useQuery<TimetableSlot[]>({
    queryKey: ["/api/timetable"],
  });

  // Fetch actual teachers data from API
  const { data: teachers = [], isLoading: teachersLoading } = useQuery<Teacher[]>({
    queryKey: ["/api/teachers"],
  });

  // Convert timetable array to Map
  const timetable = new Map<string, TimetableSlot>();
  timetableData.forEach((slot) => {
    const key = getSlotKey(slot.day, slot.schoolClass, slot.period);
    timetable.set(key, slot);
  });

  if (timetableLoading || teachersLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  let totalSlots = 0;
  let occupiedSlots = 0;
  let emptySlots = 0;
  const slotsByDay: Record<Day, { total: number; occupied: number }> = {
    Monday: { total: 0, occupied: 0 },
    Tuesday: { total: 0, occupied: 0 },
    Wednesday: { total: 0, occupied: 0 },
    Thursday: { total: 0, occupied: 0 },
    Friday: { total: 0, occupied: 0 },
  };

  for (const day of DAYS) {
    const periods = getPeriodsForDay(day);
    for (const schoolClass of CLASSES) {
      for (const period of periods) {
        totalSlots++;
        slotsByDay[day].total++;
        
        const slot = timetable.get(getSlotKey(day, schoolClass, period));
        if (slot && slot.status === "occupied") {
          occupiedSlots++;
          slotsByDay[day].occupied++;
        } else {
          emptySlots++;
        }
      }
    }
  }

  const completionPercent = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0;

  const dayChartData = DAYS.map((day) => ({
    name: day.slice(0, 3),
    occupied: slotsByDay[day].occupied,
    empty: slotsByDay[day].total - slotsByDay[day].occupied,
  }));

  const teacherWorkloads = teachers.map((t) => ({
    name: t.name.split(" ").slice(-1)[0],
    periods: calculateTeacherWorkload(timetable, t).totalPeriods,
    color: t.color,
  }));

  const topTeachers = teacherWorkloads.sort((a, b) => b.periods - a.periods).slice(0, 8);

  const statusData = [
    { name: "Scheduled", value: occupiedSlots, color: "#22c55e" },
    { name: "Free", value: emptySlots, color: "#f59e0b" },
  ];

  const fatigueWarnings = teachers.reduce((count, teacher) => {
    const workload = calculateTeacherWorkload(timetable, teacher);
    return count + workload.consecutivePeriodsWarnings.length;
  }, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          Analytics Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Overview of timetable utilization and teacher workload
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Completion Rate</p>
                <p className="text-2xl font-bold">{completionPercent}%</p>
              </div>
            </div>
            <Progress value={completionPercent} className="mt-3 h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Scheduled Periods</p>
                <p className="text-2xl font-bold">{occupiedSlots}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              of {totalSlots} total slots
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Calendar className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Free Periods</p>
                <p className="text-2xl font-bold">{emptySlots}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              across all classes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Fatigue Warnings</p>
                <p className="text-2xl font-bold">{fatigueWarnings}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              high consecutive periods
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Slots by Day</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                  />
                  <Bar dataKey="occupied" stackId="a" fill="#22c55e" name="Scheduled" />
                  <Bar dataKey="empty" stackId="a" fill="#f59e0b" name="Free" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Slot Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Teacher Workload Distribution
          </CardTitle>
          <Badge variant="secondary">{teachers.length} teachers</Badge>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topTeachers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" className="text-xs" />
                <YAxis dataKey="name" type="category" width={80} className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                />
                <Bar dataKey="periods" name="Periods" radius={[0, 4, 4, 0]}>
                  {topTeachers.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CLASSES.map((cls) => {
          let clsTotal = 0;
          let clsOccupied = 0;

          for (const day of DAYS) {
            const periods = getPeriodsForDay(day);
            for (const period of periods) {
              const slot = timetable.get(getSlotKey(day, cls, period));
              if (slot) {
                clsTotal++;
                if (slot.status === "occupied") clsOccupied++;
              }
            }
          }

          const clsPercent = clsTotal > 0 ? Math.round((clsOccupied / clsTotal) * 100) : 0;

          return (
            <Card key={cls}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant={cls.startsWith("SS") ? "default" : "secondary"}>
                    {cls}
                  </Badge>
                  <span className="text-sm font-medium">{clsPercent}%</span>
                </div>
                <Progress value={clsPercent} className="h-2" />
                <p className="text-xs text-muted-foreground mt-2">
                  {clsOccupied} of {clsTotal} periods scheduled
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
