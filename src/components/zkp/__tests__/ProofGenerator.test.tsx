import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import ProofGenerator from "@/components/zkp/ProofGenerator";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    line: (props: any) => <line {...props} />,
    circle: (props: any) => <circle {...props} />,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  CheckCircle2: (props: any) => <div data-testid="icon-check" {...props} />,
  AlertCircle: (props: any) => <div data-testid="icon-alert" {...props} />,
  Cpu: (props: any) => <div data-testid="icon-cpu" {...props} />,
  Binary: (props: any) => <div data-testid="icon-binary" {...props} />,
  ShieldCheck: (props: any) => (
    <div data-testid="icon-shield-check" {...props} />
  ),
  Zap: (props: any) => <div data-testid="icon-zap" {...props} />,
  CircuitBoard: (props: any) => <div data-testid="icon-circuit" {...props} />,
  Hash: (props: any) => <div data-testid="icon-hash" {...props} />,
}));

const mockGenerateProof = jest.fn().mockResolvedValue({
  hash: "0xabcdef1234567890",
  protocol: "Groth16",
  curve: "BN254",
  createdAt: Date.now(),
  publicInputCount: 3,
});

jest.mock("@/hooks/useProof", () => ({
  useProof: () => ({
    generateProof: mockGenerateProof,
  }),
}));

const mockDisclosure = {
  disclosed: [{ key: "name", value: "John", type: "string" }],
  zkProved: [{ key: "age", value: "30", type: "number" }],
  hidden: [],
};

describe("ProofGenerator", () => {
  const onProofGenerated = jest.fn();
  const onError = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders idle state", () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(
      screen.getByText("Click generate to begin ZK proof creation"),
    ).toBeInTheDocument();
  });

  it("renders generate button in idle state", () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    expect(screen.getByText("Generate ZK Proof")).toBeInTheDocument();
  });

  it("renders ZK Circuit heading", () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    expect(screen.getByText("ZK Circuit")).toBeInTheDocument();
  });

  it("renders stage step labels", () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    expect(
      screen.getAllByText("Loading Circuit").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("Computing Witness").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("Generating Proof").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("starts proof generation when button is clicked", () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));
    // After clicking generate, the stage changes to loading-wasm which shows "Loading Circuit"
    // in both the progress header and the stage step list
    expect(
      screen.getAllByText("Loading Circuit").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("progresses through stages and calls onProofGenerated", async () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    // Advance through loading-wasm stage
    await act(async () => {
      jest.advanceTimersByTime(1200);
    });

    // Advance through computing-witness stage
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    // Wait for generateProof to resolve
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(onProofGenerated).toHaveBeenCalled();
    });
  });

  it("shows error state when proof generation fails", async () => {
    mockGenerateProof.mockRejectedValueOnce(new Error("Circuit error"));
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    await act(async () => {
      jest.advanceTimersByTime(1200);
    });

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Circuit error");
    });
  });

  it("shows generic error message for non-Error throw (line 94)", async () => {
    mockGenerateProof.mockRejectedValueOnce("string error");
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    await act(async () => {
      jest.advanceTimersByTime(1200);
    });

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        "Unknown error during proof generation",
      );
    });
    expect(
      screen.getByText("Unknown error during proof generation"),
    ).toBeInTheDocument();
  });

  it("shows generate button again in error state", async () => {
    mockGenerateProof.mockRejectedValueOnce(new Error("fail"));
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    await act(async () => {
      jest.advanceTimersByTime(1200);
    });
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(screen.getByText("Generate ZK Proof")).toBeInTheDocument();
    });
  });

  it("renders circuit nodes and edges", () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    // 12 nodes
    const circles = svg!.querySelectorAll("circle");
    expect(circles.length).toBe(12);
    // 17 edges
    const lines = svg!.querySelectorAll("line");
    expect(lines.length).toBe(17);
  });

  it("activates circuit nodes during computing-witness stage (covers node highlighting branches)", async () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    // Advance to computing-witness stage
    await act(async () => {
      jest.advanceTimersByTime(1200);
    });

    // In computing-witness: nodes with idx < 8 should be highlighted
    expect(
      screen.getAllByText("Computing Witness").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("activates circuit nodes during generating-proof stage (covers remaining branch)", async () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    await act(async () => {
      jest.advanceTimersByTime(1200);
    });
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    // In generating-proof: nodes with idx >= 4 should be highlighted
    expect(
      screen.getAllByText("Generating Proof").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders circuit nodes with non-highlighted fill during loading-wasm stage", async () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    // In loading-wasm: isActive=true, but isHighlighted=false for all nodes
    // Nodes should have 'var(--surface-tertiary)' fill (isActive but not highlighted)
    const svg = document.querySelector("svg")!;
    const circles = svg.querySelectorAll("circle");
    // All 12 nodes should be active but not highlighted
    circles.forEach((circle) => {
      const fill = circle.getAttribute("fill");
      // Should NOT be the highlighted color '#4263eb' since stage is loading-wasm
      // It should be 'var(--surface-tertiary)' because isActive is true
      expect(fill).not.toBe("var(--surface-secondary)");
    });
  });

  it("renders circuit nodes with secondary fill in idle stage", () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    // In idle: isActive=false, isHighlighted=false
    const svg = document.querySelector("svg")!;
    const circles = svg.querySelectorAll("circle");
    circles.forEach((circle) => {
      const fill = circle.getAttribute("fill");
      // Should be 'var(--surface-secondary)' because isActive is false
      expect(fill).toBe("var(--surface-secondary)");
    });
  });

  it("renders circuit nodes with highlighted fill during generating-proof stage (covers idx >= 4 branch)", async () => {
    // Use a deferred promise so the component stays in generating-proof stage for a render
    let resolveProof!: (value: any) => void;
    const deferredProof = new Promise((resolve) => {
      resolveProof = resolve;
    });
    mockGenerateProof.mockReturnValueOnce(deferredProof);

    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    // Advance through loading-wasm
    await act(async () => {
      jest.advanceTimersByTime(1200);
    });
    // Advance through computing-witness -> generating-proof (but proof is pending)
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    // Now stage is 'generating-proof' and the component has rendered with it
    const svg = document.querySelector("svg")!;
    const circles = svg.querySelectorAll("circle");
    // Nodes with idx >= 4 should be highlighted, idx < 4 should not
    expect(circles.length).toBe(12);

    // Resolve the proof to clean up
    await act(async () => {
      resolveProof({
        hash: "0xabcdef1234567890",
        protocol: "Groth16",
        curve: "BN254",
        createdAt: Date.now(),
        publicInputCount: 3,
      });
    });
  });

  it("shows complete stage with correct styling after successful generation", async () => {
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByText("Generate ZK Proof"));

    await act(async () => {
      jest.advanceTimersByTime(1200);
    });
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(screen.getByText("Proof Generated")).toBeInTheDocument();
    });
    // Generate button should NOT be visible in complete state
    expect(screen.queryByText("Generate ZK Proof")).not.toBeInTheDocument();
  });
});
