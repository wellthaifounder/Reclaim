import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Download, X } from "lucide-react";
import { toast } from "sonner";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const PWAInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if app is already installed
    const isInStandaloneMode = window.matchMedia(
      "(display-mode: standalone)",
    ).matches;
    setIsStandalone(isInStandaloneMode);

    // Check if iOS
    const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    // Check if user has previously dismissed the prompt
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    const dismissedDate = dismissed ? new Date(dismissed) : null;
    const daysSinceDismissed = dismissedDate
      ? (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    // Show prompt if: not installed, not dismissed recently (>7 days), and not iOS (iOS uses custom prompt)
    const shouldShow =
      !isInStandaloneMode && (!dismissed || daysSinceDismissed > 7) && !iOS;

    // Listen for beforeinstallprompt event (Chrome, Edge, etc.)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (shouldShow) {
        // Delay showing prompt by 30 seconds to avoid interrupting user
        setTimeout(() => setShowPrompt(true), 30000);
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Show iOS install prompt if applicable
    if (iOS && !isInStandaloneMode && shouldShow) {
      setTimeout(() => setShowPrompt(true), 30000);
    }

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt && !isIOS) {
      return;
    }

    if (isIOS) {
      // Show iOS-specific instructions
      setShowPrompt(false);
      toast.info(
        "To install: Tap the Share button in Safari, then 'Add to Home Screen'",
        { duration: 8000 },
      );
      return;
    }

    if (deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt();

      // Wait for the user's response
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === "accepted") {
        toast.success("App installed successfully!");
      }

      // Clear the deferredPrompt
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem("pwa-install-dismissed", new Date().toISOString());
    toast.info("You can install the app anytime from your browser menu");
  };

  // Don't show if already installed or prompt not ready
  if (!showPrompt || isStandalone) {
    return null;
  }

  return (
    <div className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm z-[var(--z-toast)] animate-slide-in-right">
      <Card className="border-primary/50 shadow-2xl">
        <CardHeader className="relative pb-3">
          <Button
            variant="ghost"
            size="icon"
            className="absolute -top-2 -right-2 h-8 w-8"
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
          >
            <X className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Download className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Install Reclaim</CardTitle>
              <CardDescription className="text-xs">
                Quick access from your home screen
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="text-sm space-y-1 text-muted-foreground">
            <li className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span>Works offline</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span>Faster load times</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-primary">✓</span>
              <span>Native app experience</span>
            </li>
          </ul>

          <div className="flex gap-2">
            <Button onClick={handleInstallClick} className="flex-1" size="sm">
              <Download className="h-4 w-4 mr-2" />
              {isIOS ? "How to Install" : "Install App"}
            </Button>
            <Button variant="outline" onClick={handleDismiss} size="sm">
              Not Now
            </Button>
          </div>

          {isIOS && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              Tap Share <span className="inline-block">⎋</span> then "Add to
              Home Screen"
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
