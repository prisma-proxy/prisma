import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full w-full p-6">
          <Card className="max-w-md w-full">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <AlertTriangle className="h-10 w-10 text-destructive" />
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Something went wrong</h2>
                {this.state.error && (
                  <p className="text-sm text-muted-foreground break-all">
                    {this.state.error.message}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
