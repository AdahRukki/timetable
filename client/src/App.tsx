import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import TeachersPage from "@/pages/teachers";
import DashboardPage from "@/pages/dashboard";
import SettingsPage from "@/pages/settings";
import HelpPage from "@/pages/help";
import LandingPage from "@/pages/landing";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/teachers" component={TeachersPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/help" component={HelpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function UserMenu() {
  const { user } = useAuth();
  
  if (!user) return null;
  
  const initials = [user.firstName, user.lastName]
    .filter(Boolean)
    .map(n => n?.[0] || "")
    .join("")
    .toUpperCase() || user.email?.[0]?.toUpperCase() || "U";

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8">
          <AvatarImage src={user.profileImageUrl || undefined} alt={user.firstName || "User"} />
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium hidden sm:inline">
          {user.firstName || user.email || "User"}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        asChild
        data-testid="button-logout"
      >
        <a href="/api/logout" title="Sign out">
          <LogOut className="h-4 w-4" />
        </a>
      </Button>
    </div>
  );
}

function AuthenticatedApp() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between gap-4 px-4 py-2 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function AppContent() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isAuthenticated) {
    return <AuthenticatedApp />;
  }

  return <LandingPage />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
