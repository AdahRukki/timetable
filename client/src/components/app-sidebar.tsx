import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Calendar, LayoutDashboard, Users, Settings, HelpCircle, Save } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import type { UserSettings } from "@shared/schema";

const menuItems = [
  {
    title: "Timetable",
    url: "/",
    icon: Calendar,
    description: "Build and manage schedules",
  },
  {
    title: "Teachers",
    url: "/teachers",
    icon: Users,
    description: "Manage teacher profiles",
  },
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
    description: "Analytics and reports",
  },
  {
    title: "Saved Timetables",
    url: "/saved-timetables",
    icon: Save,
    description: "Load, rename, or delete saved timetables",
  },
];

const bottomItems = [
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
  {
    title: "Help",
    url: "/help",
    icon: HelpCircle,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  
  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/settings"],
  });
  
  const fatigueLimit = userSettings?.fatigueLimit ?? 5;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Calendar className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate">Timetable Builder</h2>
            <p className="text-xs text-muted-foreground truncate">
              Schedule Manager
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.description}
                    >
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase()}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Quick Info</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-3 py-2 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Classes</span>
                <Badge variant="secondary" className="text-xs">6</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Days</span>
                <Badge variant="secondary" className="text-xs">5</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Max Periods</span>
                <Badge variant="secondary" className="text-xs">9</Badge>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Rules Active</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-3 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs">Teacher clash prevention</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs">Fatigue limit ({fatigueLimit} consecutive)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs">Break enforcement</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs">Slash subject pairing</span>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {bottomItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild tooltip={item.title}>
                <Link href={item.url}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
