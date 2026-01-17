import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, Users, Zap, Shield, Clock, CheckCircle } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Calendar className="h-5 w-5" />
              </div>
              <span className="font-semibold text-lg">Timetable Builder</span>
            </div>
            <Button asChild data-testid="button-login">
              <a href="/api/login">Sign in with Google</a>
            </Button>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              Build Smart School Timetables
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              The intelligent scheduling solution for Nigerian secondary schools. 
              Automatically prevents clashes, manages teacher workloads, and enforces curriculum rules.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
              <Button size="lg" asChild data-testid="button-get-started">
                <a href="/api/login">Get Started Free</a>
              </Button>
            </div>
            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle className="h-4 w-4 text-green-500" />
                Free forever
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle className="h-4 w-4 text-green-500" />
                No credit card required
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <Shield className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Clash Prevention</h3>
                <p className="text-muted-foreground text-sm">
                  Automatically prevents teacher double-booking. No more scheduling conflicts across classes.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <Clock className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Fatigue Management</h3>
                <p className="text-muted-foreground text-sm">
                  Enforces maximum 5 consecutive periods per teacher. Keeps your staff productive and healthy.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <Users className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Slash Subject Pairing</h3>
                <p className="text-muted-foreground text-sm">
                  Built-in support for SS2/SS3 paired subjects. Physics/Literature, Chemistry/Government, and more.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <Calendar className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Variable Day Structure</h3>
                <p className="text-muted-foreground text-sm">
                  Handles different period counts per day. Monday 9, Tuesday 7, Friday 6 periods - all managed.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <Zap className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Auto-Generation</h3>
                <p className="text-muted-foreground text-sm">
                  One-click schedule generation using smart algorithms. Respects all rules and teacher preferences.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <CheckCircle className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Subject Quotas</h3>
                <p className="text-muted-foreground text-sm">
                  Configure periods per subject per class. Tracks allocations and ensures curriculum compliance.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="text-center">
            <h2 className="font-serif text-2xl sm:text-3xl font-bold mb-4">
              Ready to simplify your scheduling?
            </h2>
            <p className="text-muted-foreground mb-6">
              Join schools across Nigeria using our intelligent timetable builder.
            </p>
            <Button size="lg" asChild data-testid="button-signup-bottom">
              <a href="/api/login">Sign Up with Google</a>
            </Button>
          </div>
        </div>
      </main>

      <footer className="border-t py-8 px-4 text-center text-sm text-muted-foreground">
        <p>Timetable Builder for Nigerian Secondary Schools</p>
      </footer>
    </div>
  );
}
