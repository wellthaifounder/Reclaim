import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { logError } from "@/utils/errorHandler";
import { Button } from "@/components/ui/button";
import { ReclaimLogo } from "@/components/ReclaimLogo";
import { useAuthUser } from "@/hooks/useAuthUser";

const NotFound = () => {
  const location = useLocation();
  const { user } = useAuthUser();

  useEffect(() => {
    logError(
      "404 Error: User attempted to access non-existent route",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <ReclaimLogo size="lg" showTagline />
      <div className="space-y-2">
        <h1 className="text-5xl font-bold text-foreground">404</h1>
        <p className="text-xl text-muted-foreground">
          This page doesn't exist — the link may be out of date.
        </p>
      </div>
      <Button asChild size="lg">
        <Link to={user ? "/dashboard" : "/"}>
          {user ? "Back to Dashboard" : "Back to Reclaim"}
        </Link>
      </Button>
    </div>
  );
};

export default NotFound;
