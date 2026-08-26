import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RefreshCw, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

export const PWAUpdatePrompt = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(_r) {
      // Service worker registered
    },
    onRegisterError(_error) {
      // Service worker registration failed
    },
  });

  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (needRefresh) {
      setShowPrompt(true);
    }
  }, [needRefresh]);

  const handleUpdate = () => {
    updateServiceWorker(true);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setNeedRefresh(false);
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div className="fixed top-20 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm z-[var(--z-toast)] animate-slide-in-right">
      <Card className="border-amber-500/50 shadow-2xl bg-card">
        <CardHeader className="relative pb-3">
          <Button
            variant="ghost"
            size="icon"
            className="absolute -top-2 -right-2 h-8 w-8"
            onClick={handleDismiss}
            aria-label="Dismiss update prompt"
          >
            <X className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <RefreshCw className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <CardTitle className="text-lg">Update Available</CardTitle>
              <CardDescription className="text-xs">
                A new version of Reclaim is ready
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            We've made improvements to enhance your experience. Update now to
            get the latest features and bug fixes.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleUpdate} className="flex-1" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Update Now
            </Button>
            <Button variant="outline" onClick={handleDismiss} size="sm">
              Later
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
