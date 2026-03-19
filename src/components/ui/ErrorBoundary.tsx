import React, { Component, ErrorInfo } from "react";
import { AlertTriangle, RefreshCw, Home, Bug } from "lucide-react";

// ============================================================
// Error Boundary Component
// ============================================================

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    return { hasError: true, error, errorId };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ZeroID ErrorBoundary]", {
      error,
      componentStack: errorInfo.componentStack,
      errorId: this.state.errorId,
    });

    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="bg-zero-900 border border-zero-700 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
            {/* Error icon */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
            </div>

            {/* Error message */}
            <h2 className="text-xl font-bold text-white mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-zero-400 mb-2">
              An unexpected error occurred. This has been logged for
              investigation.
            </p>

            {/* Error ID */}
            {this.state.errorId && (
              <p className="text-xs text-zero-600 mb-4 font-mono">
                Error ID: {this.state.errorId}
              </p>
            )}

            {/* Dev-only error details */}
            {process.env.NODE_ENV === "development" && this.state.error && (
              <div className="mb-6">
                <div className="flex items-center gap-1.5 text-xs text-zero-500 mb-1.5">
                  <Bug className="w-3 h-3" />
                  <span>Development Error Details</span>
                </div>
                <pre className="text-xs text-red-400 bg-red-500/5 border border-red-500/10 rounded-lg p-3 text-left overflow-auto max-h-32 font-mono">
                  {this.state.error.message}
                  {this.state.error.stack && (
                    <>
                      {"\n\n"}
                      {this.state.error.stack
                        .split("\n")
                        .slice(1, 5)
                        .join("\n")}
                    </>
                  )}
                </pre>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleGoHome}
                className="inline-flex items-center gap-2 px-4 py-2.5 border border-zero-700 hover:bg-zero-800 text-zero-300 rounded-xl text-sm font-medium transition-colors"
              >
                <Home className="w-4 h-4" />
                Go Home
              </button>
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-cyan-500/20"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
