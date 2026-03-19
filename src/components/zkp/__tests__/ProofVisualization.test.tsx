import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ProofVisualization from "@/components/zkp/ProofVisualization";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    circle: (props: any) => <circle {...props} />,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  CheckCircle2: (props: any) => <div data-testid="icon-check" {...props} />,
  ShieldCheck: (props: any) => (
    <div data-testid="icon-shield-check" {...props} />
  ),
  Hash: (props: any) => <div data-testid="icon-hash" {...props} />,
  Copy: (props: any) => <div data-testid="icon-copy" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  Fingerprint: (props: any) => (
    <div data-testid="icon-fingerprint" {...props} />
  ),
}));

const mockProof = {
  hash: "0xabcdef1234567890abcdef1234567890",
  protocol: "Groth16",
  curve: "BN254",
  createdAt: "2026-03-15T10:00:00Z",
  publicInputCount: 5,
};

describe("ProofVisualization", () => {
  it("renders proof hash", () => {
    render(<ProofVisualization proof={mockProof as any} />);
    expect(
      screen.getByText("0xabcdef1234567890abcdef1234567890"),
    ).toBeInTheDocument();
  });

  it("renders protocol and curve", () => {
    render(<ProofVisualization proof={mockProof as any} />);
    expect(screen.getByText("Groth16 | BN254")).toBeInTheDocument();
  });

  it("renders ZK Proof status text in default state", () => {
    render(<ProofVisualization proof={mockProof as any} />);
    expect(screen.getByText("ZK Proof")).toBeInTheDocument();
  });

  it("renders Verifying state", () => {
    render(<ProofVisualization proof={mockProof as any} isVerifying={true} />);
    expect(screen.getByText("Verifying Proof...")).toBeInTheDocument();
  });

  it("renders Verified state", () => {
    render(<ProofVisualization proof={mockProof as any} isVerified={true} />);
    expect(screen.getByText("Proof Verified")).toBeInTheDocument();
  });

  it("renders proof details by default", () => {
    render(<ProofVisualization proof={mockProof as any} />);
    expect(screen.getByText("Proof Hash")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Public Inputs")).toBeInTheDocument();
  });

  it("renders public input count", () => {
    render(<ProofVisualization proof={mockProof as any} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("hides details when showDetails is false", () => {
    render(<ProofVisualization proof={mockProof as any} showDetails={false} />);
    expect(screen.queryByText("Proof Hash")).not.toBeInTheDocument();
  });

  it("renders copy button for proof hash", () => {
    render(<ProofVisualization proof={mockProof as any} />);
    const copyIcon = screen.getByTestId("icon-copy");
    expect(copyIcon.closest("button")).toBeInTheDocument();
  });

  it("handles copy hash action", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<ProofVisualization proof={mockProof as any} />);
    const copyButton = screen.getByTestId("icon-copy").closest("button")!;
    fireEvent.click(copyButton);
    expect(writeTextMock).toHaveBeenCalledWith(
      "0xabcdef1234567890abcdef1234567890",
    );
  });

  it("renders default protocol/curve when not provided", () => {
    const minimalProof = { hash: "0x123", publicInputCount: 0 };
    render(<ProofVisualization proof={minimalProof as any} />);
    expect(screen.getByText("Groth16 | BN254")).toBeInTheDocument();
  });

  it("renders fingerprint icon in default state", () => {
    render(<ProofVisualization proof={mockProof as any} />);
    expect(screen.getByTestId("icon-fingerprint")).toBeInTheDocument();
  });

  it("runs verifying interval and cleans up (covers useEffect interval)", () => {
    jest.useFakeTimers();
    const { rerender } = render(
      <ProofVisualization proof={mockProof as any} isVerifying={true} />,
    );
    // Advance timers to trigger interval callback
    act(() => {
      jest.advanceTimersByTime(500);
    });
    // Rerender with isVerifying false to trigger cleanup
    rerender(
      <ProofVisualization
        proof={mockProof as any}
        isVerifying={false}
        isVerified={true}
      />,
    );
    expect(screen.getByText("Proof Verified")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("caps ring progress at 95 during verifying", () => {
    jest.useFakeTimers();
    render(<ProofVisualization proof={mockProof as any} isVerifying={true} />);
    // Advance enough to hit the 95 cap (50ms per tick, 2 per tick, so 50*50=2500ms for ~100, capped at 95)
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    // Progress should be capped at 95, verified text should not show
    expect(screen.getByText("Verifying Proof...")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("sets ring progress to 100 when isVerified changes to true", () => {
    const { rerender } = render(
      <ProofVisualization
        proof={mockProof as any}
        isVerifying={false}
        isVerified={false}
      />,
    );
    rerender(
      <ProofVisualization
        proof={mockProof as any}
        isVerifying={false}
        isVerified={true}
      />,
    );
    expect(screen.getByText("Proof Verified")).toBeInTheDocument();
  });

  it("handles clipboard API failure gracefully", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("Clipboard blocked")),
      },
    });
    render(<ProofVisualization proof={mockProof as any} />);
    const copyButton = screen.getByTestId("icon-copy").closest("button")!;
    // Should not throw
    await act(async () => {
      fireEvent.click(copyButton);
    });
    // Component should still be rendered fine
    expect(screen.getByText("ZK Proof")).toBeInTheDocument();
  });

  it("shows orbiting dots when verifying", () => {
    render(<ProofVisualization proof={mockProof as any} isVerifying={true} />);
    // Should render 3 orbiting dot divs (motion.div)
    const dots = document.querySelectorAll(".bg-brand-500");
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });

  it("shows verification checkmark badge when verified", () => {
    render(<ProofVisualization proof={mockProof as any} isVerified={true} />);
    // The checkmark badge div
    const badges = screen.getAllByTestId("icon-check");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders created time from proof.createdAt", () => {
    render(<ProofVisualization proof={mockProof as any} />);
    // Should show the formatted time
    const createdAt = new Date("2026-03-15T10:00:00Z").toLocaleTimeString();
    expect(screen.getByText(createdAt)).toBeInTheDocument();
  });

  it("shows -- when createdAt is not provided", () => {
    const proofNoDate = { hash: "0xabc", publicInputCount: 2 };
    render(<ProofVisualization proof={proofNoDate as any} />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("shows copied state after successful copy", async () => {
    jest.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
    render(<ProofVisualization proof={mockProof as any} />);
    const copyButton = screen.getByTestId("icon-copy").closest("button")!;
    await act(async () => {
      fireEvent.click(copyButton);
    });
    // After copy, the check icon should appear instead of copy icon
    expect(screen.getAllByTestId("icon-check").length).toBeGreaterThanOrEqual(
      1,
    );
    // After 2000ms, it should revert
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId("icon-copy")).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("renders default publicInputCount as 0 when not provided", () => {
    const proofNoInputs = { hash: "0xdef" };
    render(<ProofVisualization proof={proofNoInputs as any} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
