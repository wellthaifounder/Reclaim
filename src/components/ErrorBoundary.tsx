import { Component, ErrorInfo, ReactNode } from "react";
import { logError } from "@/utils/errorHandler";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackDescription?: string;
  onReset?: () => void;
  showHomeButton?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details for debugging
    logError("ErrorBoundary caught an error", error, { errorInfo });

    this.setState({
      error,
      errorInfo,
    });

    // You could also log to an error reporting service here
    // e.g., Sentry, LogRocket, etc.
  }

  handleReset = () => {
    // Reset error state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Call custom reset handler if provided
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleGoHome = () => {
    window.location.href = "/dashboard";
  };

  render() {
    if (this.state.hasError) {
      const {
        fallbackTitle = "Something went wrong",
        fallbackDescription = "We encountered an unexpected error. Please try refreshing the page or contact support if the problem persists.",
        showHomeButton = true,
      } = this.props;

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <Card className="max-w-2xl w-full border-destructive/50">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-destructive/10 p-4">
                  <AlertTriangle className="h-12 w-12 text-destructive" />
                </div>
              </div>
              <CardTitle className="text-2xl">{fallbackTitle}</CardTitle>
              <CardDescription className="text-base mt-2">
                {fallbackDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Error details for debugging (only in development) */}
              {process.env.NODE_ENV === "development" && this.state.error && (
                <details className="rounded-lg bg-muted p-4 text-sm">
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    Error Details (Development Only)
                  </summary>
                  <div className="mt-3 space-y-2">
                    <div>
                      <p className="font-semibold text-destructive">
                        {this.state.error.toString()}
                      </p>
                    </div>
                    {this.state.errorInfo && (
                      <div className="mt-2">
                        <p className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
                          {this.state.errorInfo.componentStack}
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              )}

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={this.handleReset} size="lg" className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
                {showHomeButton && (
                  <Button
                    onClick={this.handleGoHome}
                    variant="outline"
                    size="lg"
                    className="gap-2"
                  >
                    <Home className="h-4 w-4" />
                    Go to Dashboard
                  </Button>
                )}
              </div>

              {/* Help text */}
              <div className="text-center">
                <p className="text-sm text-muted-foreground">
                  If this problem continues, please{" "}
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("openWellbieChat"));
                    }}
                    className="text-primary hover:underline font-medium"
                  >
                    contact support via Wellbie
                  </button>
                  .
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
