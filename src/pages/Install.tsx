import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeft,
  Download,
  Smartphone,
  Zap,
  Wifi,
  Bell,
  Shield,
  CheckCircle2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Navigation } from "@/components/Navigation";
import { AuthenticatedNav } from "@/components/AuthenticatedNav";
import { supabase } from "@/integrations/supabase/client";

const Install = () => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Check authentication status
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsAuthenticated(!!user);
    });

    // Check if iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(ios);

    // Check if already installed
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      if (isIOS) {
        // Scroll to iOS instructions
        document
          .getElementById("ios-instructions")
          ?.scrollIntoView({ behavior: "smooth" });
      }
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  const benefits = [
    {
      icon: Zap,
      title: "Instant Access",
      description:
        "Launch the app instantly from your home screen without opening a browser",
    },
    {
      icon: Wifi,
      title: "Offline Support",
      description:
        "View your expenses and track your HSA even without an internet connection",
    },
    {
      icon: Bell,
      title: "Push Notifications",
      description:
        "Get timely reminders about reimbursements and important updates",
    },
    {
      icon: Shield,
      title: "Secure & Private",
      description:
        "Your data stays safe with app-level security and encrypted storage",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {isAuthenticated ? <AuthenticatedNav /> : <Navigation />}

      <div className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-4xl">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate(isAuthenticated ? "/dashboard" : "/")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>

        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Download className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-4xl font-bold mb-4">Install Reclaim</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Get the full app experience with instant access, offline support,
            and push notifications
          </p>
        </div>

        {isStandalone && (
          <Card className="mb-8 border-success bg-success/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-success" />
                <div>
                  <p className="font-semibold text-success">
                    App Already Installed!
                  </p>
                  <p className="text-sm text-muted-foreground">
                    You're using Reclaim as an installed app.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 mb-12">
          <h2 className="text-2xl font-bold">Why Install?</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {benefits.map((benefit, index) => (
              <Card key={index}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <benefit.icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{benefit.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{benefit.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-bold mb-6">
              Installation Instructions
            </h2>

            {/* Android/Chrome Instructions */}
            {!isIOS && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Smartphone className="h-5 w-5" />
                    Android / Chrome
                  </CardTitle>
                  <CardDescription>
                    Install on Android devices or Chrome browser
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {deferredPrompt ? (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Click the button below to install Reclaim on your
                        device:
                      </p>
                      <Button
                        onClick={handleInstall}
                        size="lg"
                        className="w-full"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Install App Now
                      </Button>
                    </div>
                  ) : (
                    <ol className="space-y-3 text-sm">
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          1
                        </span>
                        <span>
                          Tap the menu icon (⋮) in the top-right corner of
                          Chrome
                        </span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          2
                        </span>
                        <span>
                          Select "Install app" or "Add to Home screen"
                        </span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          3
                        </span>
                        <span>Tap "Install" when prompted</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                          4
                        </span>
                        <span>The app will appear on your home screen</span>
                      </li>
                    </ol>
                  )}
                </CardContent>
              </Card>
            )}

            {/* iOS Instructions */}
            <Card id="ios-instructions">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5" />
                  iOS / Safari
                </CardTitle>
                <CardDescription>
                  Install on iPhone or iPad using Safari
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                      1
                    </span>
                    <span>
                      Open Reclaim in Safari (this won't work in Chrome on iOS)
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                      2
                    </span>
                    <span>
                      Tap the Share button (square with arrow pointing up) at
                      the bottom of the screen
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                      3
                    </span>
                    <span>Scroll down and tap "Add to Home Screen"</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                      4
                    </span>
                    <span>Tap "Add" in the top-right corner</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                      5
                    </span>
                    <span>
                      The Reclaim icon will appear on your home screen
                    </span>
                  </li>
                </ol>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-muted/50">
            <CardHeader>
              <CardTitle>Need Help?</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                If you're having trouble installing the app, make sure you're
                using a supported browser (Chrome, Safari, Edge, or Firefox) and
                that your device allows app installations.
              </p>
              <p className="text-sm text-muted-foreground">
                For detailed troubleshooting, visit our support documentation or
                contact us at support@wellth.ai
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Install;
