import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  HelpCircle,
  Calendar,
  Users,
  AlertTriangle,
  Clock,
  BookOpen,
  Layers,
} from "lucide-react";

export default function HelpPage() {
  const faqs = [
    {
      question: "How do I schedule a period?",
      answer:
        "Click on any empty cell in the timetable grid. A dialog will open where you can select a subject, teacher, and period type (single, double, or slash for SS2/SS3). The system will validate your selection before allowing placement.",
    },
    {
      question: "What is a double period?",
      answer:
        "A double period schedules the same subject for two consecutive periods. Double periods cannot cross breaks (after P4 or P7) and are not allowed in P8 or P9.",
    },
    {
      question: "What are slash subjects?",
      answer:
        "Slash subjects are paired subjects for SS2 and SS3 classes that must be scheduled at the same time. The pairs are: Physics/Literature (4 periods), Chemistry/Government (4 periods), and Agric/CRS (3 periods).",
    },
    {
      question: "Why can't I place a teacher in a period?",
      answer:
        "Common reasons include: the teacher is already teaching another class at that time, they're unavailable on that day/period, or adding this period would exceed their 5 consecutive period fatigue limit.",
    },
    {
      question: "What is the fatigue limit rule?",
      answer:
        "Teachers cannot teach more than 5 consecutive periods in a day. Breaks and free periods reset this count. The system will warn you if a placement would violate this rule.",
    },
    {
      question: "How do I undo a mistake?",
      answer:
        "Use the Undo button in the History panel on the right side of the screen. You can also Redo if you change your mind. Each action is tracked and can be reversed.",
    },
    {
      question: "Why are some periods shorter on certain days?",
      answer:
        "Tuesday has only 7 periods (P1-P7) and Friday has only 6 periods (P1-P6). Monday, Wednesday, and Thursday have the full 9 periods.",
    },
  ];

  const rules = [
    {
      title: "Teacher Clash Prevention",
      description: "A teacher cannot be in two classes at the same period",
      icon: Users,
      severity: "error",
    },
    {
      title: "Fatigue Limit",
      description: "Maximum 5 consecutive teaching periods per teacher per day",
      icon: Clock,
      severity: "error",
    },
    {
      title: "Break Enforcement",
      description: "Double periods cannot cross break times",
      icon: Calendar,
      severity: "error",
    },
    {
      title: "No Doubles in P8/P9",
      description: "Double periods are not allowed in late periods",
      icon: Layers,
      severity: "error",
    },
    {
      title: "English-Security Rule",
      description: "Security cannot immediately follow English for the same class",
      icon: BookOpen,
      severity: "error",
    },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HelpCircle className="h-6 w-6 text-primary" />
          Help & Documentation
        </h1>
        <p className="text-muted-foreground mt-1">
          Learn how to use the timetable builder effectively
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Start Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                  1
                </span>
                Select a Day
              </h4>
              <p className="text-sm text-muted-foreground pl-8">
                Use the day tabs at the top of the timetable grid to switch between days.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                  2
                </span>
                Click an Empty Cell
              </h4>
              <p className="text-sm text-muted-foreground pl-8">
                Empty cells show a "+" icon on hover. Click to open the scheduling dialog.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                  3
                </span>
                Select Subject & Teacher
              </h4>
              <p className="text-sm text-muted-foreground pl-8">
                Choose the subject first, then select from available teachers.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
                  4
                </span>
                Review Validation
              </h4>
              <p className="text-sm text-muted-foreground pl-8">
                Check the validation messages before confirming the placement.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {rules.map((rule) => (
              <div
                key={rule.title}
                className="flex items-start gap-3 p-3 rounded-lg border bg-card"
              >
                <div
                  className={`p-2 rounded-lg ${
                    rule.severity === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  <rule.icon className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="font-medium text-sm">{rule.title}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {rule.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frequently Asked Questions</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="text-left text-sm">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Period Structure</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium">Day</th>
                  <th className="text-left py-2 pr-4 font-medium">Periods</th>
                  <th className="text-left py-2 font-medium">Breaks</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-2 pr-4">Monday</td>
                  <td className="py-2 pr-4">P1 - P9</td>
                  <td className="py-2">After P4, After P7</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4">Tuesday</td>
                  <td className="py-2 pr-4">P1 - P7</td>
                  <td className="py-2">After P4</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4">Wednesday</td>
                  <td className="py-2 pr-4">P1 - P9</td>
                  <td className="py-2">After P4, After P7</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4">Thursday</td>
                  <td className="py-2 pr-4">P1 - P9</td>
                  <td className="py-2">After P4, After P7</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Friday</td>
                  <td className="py-2 pr-4">P1 - P6</td>
                  <td className="py-2">Prayer 11:30, Break 12:00</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
