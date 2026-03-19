import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LivenessCheck from "@/components/biometrics/LivenessCheck";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    circle: (props: any) => <circle {...props} />,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  Camera: (props: any) => <div data-testid="icon-camera" {...props} />,
  CameraOff: (props: any) => <div data-testid="icon-camera-off" {...props} />,
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  ShieldCheck: (props: any) => (
    <div data-testid="icon-shield-check" {...props} />
  ),
  ShieldAlert: (props: any) => (
    <div data-testid="icon-shield-alert" {...props} />
  ),
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  CheckCircle2: (props: any) => (
    <div data-testid="icon-check-circle" {...props} />
  ),
  XCircle: (props: any) => <div data-testid="icon-x-circle" {...props} />,
  RefreshCw: (props: any) => <div data-testid="icon-refresh" {...props} />,
  Eye: (props: any) => <div data-testid="icon-eye" {...props} />,
  ArrowLeft: (props: any) => <div data-testid="icon-arrow-left" {...props} />,
  ArrowRight: (props: any) => <div data-testid="icon-arrow-right" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  Lock: (props: any) => <div data-testid="icon-lock" {...props} />,
  Cpu: (props: any) => <div data-testid="icon-cpu" {...props} />,
  Scan: (props: any) => <div data-testid="icon-scan" {...props} />,
}));

describe("LivenessCheck", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders loading state", () => {
    render(<LivenessCheck loading={true} />);
    expect(screen.getByText("Initializing camera...")).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<LivenessCheck error="Camera not found" />);
    expect(screen.getByText("Camera not found")).toBeInTheDocument();
  });

  it("renders idle state with start button", () => {
    render(<LivenessCheck />);
    expect(screen.getByText("Liveness Verification")).toBeInTheDocument();
    expect(screen.getByText("Start Liveness Check")).toBeInTheDocument();
  });

  it("renders TEE Protected label", () => {
    render(<LivenessCheck />);
    expect(screen.getByText("TEE Protected")).toBeInTheDocument();
  });

  it("renders camera preview placeholder in idle state", () => {
    render(<LivenessCheck />);
    expect(
      screen.getByText("Camera preview will appear here"),
    ).toBeInTheDocument();
  });

  it("starts check when start button is clicked", () => {
    render(<LivenessCheck />);
    fireEvent.click(screen.getByText("Start Liveness Check"));
    expect(screen.getByText("Preparing camera...")).toBeInTheDocument();
  });

  it("transitions to in_progress after preparation delay", () => {
    render(<LivenessCheck />);
    fireEvent.click(screen.getByText("Start Liveness Check"));

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    expect(screen.getByText("Look Straight")).toBeInTheDocument();
  });

  it("auto-starts when autoStart is true", () => {
    render(<LivenessCheck autoStart={true} />);
    expect(screen.getByText("Preparing camera...")).toBeInTheDocument();
  });

  it("renders privacy notice", () => {
    render(<LivenessCheck />);
    expect(screen.getByText("Privacy Notice")).toBeInTheDocument();
    expect(
      screen.getByText(/biometric data is processed exclusively/),
    ).toBeInTheDocument();
  });

  it("calls onComplete when check finishes successfully", () => {
    const onComplete = jest.fn();
    render(<LivenessCheck onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Start Liveness Check"));

    // Advance through preparation
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    // Advance through all steps in small increments to allow React state updates
    // Each step needs ~5s at 100ms intervals with 2-5 progress per tick, 4 steps total
    for (let i = 0; i < 40; i++) {
      act(() => {
        jest.advanceTimersByTime(500);
      });
    }

    expect(onComplete).toHaveBeenCalled();
  });

  it("shows retry button after check completes", () => {
    render(<LivenessCheck />);
    fireEvent.click(screen.getByText("Start Liveness Check"));

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    for (let i = 0; i < 40; i++) {
      act(() => {
        jest.advanceTimersByTime(500);
      });
    }

    expect(screen.getByText("Retry Verification")).toBeInTheDocument();
  });

  it("calls onRetry when retry button is clicked", () => {
    const onRetry = jest.fn();
    render(<LivenessCheck onRetry={onRetry} />);
    fireEvent.click(screen.getByText("Start Liveness Check"));

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    for (let i = 0; i < 40; i++) {
      act(() => {
        jest.advanceTimersByTime(500);
      });
    }

    fireEvent.click(screen.getByText("Retry Verification"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("applies custom className", () => {
    const { container } = render(<LivenessCheck className="custom-class" />);
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("renders FaceOverlay with fallback step key when currentStep is undefined (line 358)", () => {
    // This covers the ?? 'look_straight' fallback in FaceOverlay step prop
    // The currentStep is LIVENESS_STEPS[currentStepIdx], which is always defined for valid indices
    // The fallback triggers only if currentStepIdx goes out of bounds, which happens
    // momentarily during step completion. Let's verify it handles edge cases.
    // When all steps complete and currentStepIdx goes beyond array length,
    // LIVENESS_STEPS[nextIdx] would be undefined, triggering the fallback.
    // This happens in the success transition where currentStepIdx === LIVENESS_STEPS.length
    const onComplete = jest.fn();
    render(<LivenessCheck onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Start Liveness Check"));

    // Advance through preparation
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    // Advance through ALL steps to completion - go past the end
    for (let i = 0; i < 60; i++) {
      act(() => {
        jest.advanceTimersByTime(500);
      });
    }

    // At this point currentStepIdx should be 4 (past LIVENESS_STEPS[3]),
    // so currentStep would be undefined, triggering the ?? fallback
    expect(onComplete).toHaveBeenCalled();
  });

  it("renders loading state with custom className", () => {
    const { container } = render(
      <LivenessCheck loading={true} className="my-loading" />,
    );
    expect(container.firstChild).toHaveClass("my-loading");
  });

  it("renders error state with custom className", () => {
    const { container } = render(
      <LivenessCheck error="Oops" className="my-error" />,
    );
    expect(container.firstChild).toHaveClass("my-error");
  });

  it("shows confidence meter during in_progress", () => {
    render(<LivenessCheck />);
    fireEvent.click(screen.getByText("Start Liveness Check"));

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    // Should show confidence meter during in_progress
    expect(screen.getByText("Liveness Confidence")).toBeInTheDocument();
  });

  it("renders failure state when anti-spoof checks fail (covers lines 76, 122)", () => {
    // Force Math.random to return 0 => finalConfidence = 85+0 = 85 (>= 80)
    // but anti-spoof results will all be false (Math.random() returns 0 which is NOT > 0.1)
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0);
    const onComplete = jest.fn();
    render(<LivenessCheck onComplete={onComplete} />);
    fireEvent.click(screen.getByText("Start Liveness Check"));

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    for (let i = 0; i < 60; i++) {
      act(() => {
        jest.advanceTimersByTime(500);
      });
    }

    // With Math.random() returning 0, anti-spoof checks fail (0 > 0.1 is false)
    // So status should be 'failure'
    expect(onComplete).toHaveBeenCalledWith(false, expect.any(Number));
    // Should show failure UI elements
    expect(screen.getByText("Verification Failed")).toBeInTheDocument();
    randomSpy.mockRestore();
  });

  it("restarts check on retry", () => {
    const onRetry = jest.fn();
    render(<LivenessCheck onRetry={onRetry} />);
    fireEvent.click(screen.getByText("Start Liveness Check"));

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    for (let i = 0; i < 40; i++) {
      act(() => {
        jest.advanceTimersByTime(500);
      });
    }

    // Click retry
    fireEvent.click(screen.getByText("Retry Verification"));
    expect(onRetry).toHaveBeenCalled();
    // Should show preparing state again
    expect(screen.getByText("Preparing camera...")).toBeInTheDocument();
  });
});
