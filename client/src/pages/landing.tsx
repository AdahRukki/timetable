import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Calendar, Users, Zap, Shield, Clock, CheckCircle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

function AuthCard() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", email: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (values: LoginValues) => {
      const res = await apiRequest("POST", "/api/auth/login", values);
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: (err: Error) => {
      toast({ title: "Sign in failed", description: err.message, variant: "destructive" });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (values: RegisterValues) => {
      const res = await apiRequest("POST", "/api/auth/register", values);
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Welcome!", description: "Your account has been created." });
    },
    onError: (err: Error) => {
      toast({ title: "Sign up failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card className="w-full max-w-md mx-auto" data-testid="card-auth">
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>Sign in or create an account to start building timetables.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "register")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login" data-testid="tab-login">Sign in</TabsTrigger>
            <TabsTrigger value="register" data-testid="tab-register">Sign up</TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="pt-4">
            <Form {...loginForm}>
              <form
                onSubmit={loginForm.handleSubmit((v) => loginMutation.mutate(v))}
                className="space-y-3"
              >
                <FormField
                  control={loginForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="email" data-testid="input-login-email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={loginForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="current-password" data-testid="input-login-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-submit-login">
                  {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign in
                </Button>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="register" className="pt-4">
            <Form {...registerForm}>
              <form
                onSubmit={registerForm.handleSubmit((v) => registerMutation.mutate(v))}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={registerForm.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First name</FormLabel>
                        <FormControl>
                          <Input data-testid="input-register-firstname" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last name</FormLabel>
                        <FormControl>
                          <Input data-testid="input-register-lastname" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={registerForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="email" data-testid="input-register-email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={registerForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" data-testid="input-register-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={registerMutation.isPending} data-testid="button-submit-register">
                  {registerMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create account
                </Button>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default function LandingPage() {
  const scrollToAuth = () => {
    document.getElementById("auth")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

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
            <Button onClick={scrollToAuth} data-testid="button-login">
              Sign in
            </Button>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center mb-16">
            <div className="text-center lg:text-left">
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
                Build Smart School Timetables
              </h1>
              <p className="text-lg sm:text-xl text-muted-foreground mb-8">
                The intelligent scheduling solution for Nigerian secondary schools.
                Automatically prevents clashes, manages teacher workloads, and enforces curriculum rules.
              </p>
              <div className="flex items-center justify-center lg:justify-start gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Free forever
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Self-hosted
                </span>
              </div>
            </div>
            <div id="auth">
              <AuthCard />
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
                  Enforces a configurable maximum of consecutive periods per teacher. Keeps your staff productive.
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
        </div>
      </main>

      <footer className="border-t py-8 px-4 text-center text-sm text-muted-foreground">
        <p>Timetable Builder for Nigerian Secondary Schools</p>
      </footer>
    </div>
  );
}
