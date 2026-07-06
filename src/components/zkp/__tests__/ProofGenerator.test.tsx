import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

const mockProof = {
  hash: "0xabcdef1234567890",
  protocol: "Groth16",
  curve: "BN254",
  createdAt: Date.now(),
  publicInputCount: 3,
};

const mockGenerateProof = jest.fn();
let mockProgress = { stage: "idle", percent: 0 };

jest.mock("@/hooks/useProof", () => ({
  useProof: () => ({
    generateProof: mockGenerateProof,
    progress: mockProgress,
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

  const renderGenerator = () =>
    render(
      <ProofGenerator
        disclosure={mockDisclosure as any}
        onProofGenerated={onProofGenerated}
        onError={onError}
      />,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockProgress = { stage: "idle", percent: 0 };
    mockGenerateProof.mockResolvedValue(mockProof);
  });

  it("renders idle state", () => {
    renderGenerator();

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(
      screen.getByText("Click generate to begin ZK proof creation"),
    ).toBeInTheDocument();
    expect(screen.getByText("Generate ZK Proof")).toBeInTheDocument();
  });

  it("renders circuit visualization and real prover stage labels", () => {
    renderGenerator();

    expect(screen.getByText("ZK Circuit")).toBeInTheDocument();
    expect(
      screen.getAllByText("Loading Circuit").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("Loading Proving Key").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText("Generating Proof").length,
    ).toBeGreaterThanOrEqual(1);

    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.querySelectorAll("circle")).toHaveLength(12);
    expect(svg!.querySelectorAll("line")).toHaveLength(17);
  });

  it("starts proof generation immediately without artificial timers", async () => {
    renderGenerator();

    fireEvent.click(screen.getByText("Generate ZK Proof"));

    expect(
      screen.getAllByText("Loading Circuit").length,
    ).toBeGreaterThanOrEqual(1);
    expect(mockGenerateProof).toHaveBeenCalledWith(mockDisclosure);

    await waitFor(() => {
      expect(onProofGenerated).toHaveBeenCalledWith(mockProof);
    });
  });

  it("maps hook progress to the proving-key stage", async () => {
    let resolveProof!: (proof: typeof mockProof) => void;
    mockGenerateProof.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProof = resolve;
      }),
    );
    const view = renderGenerator();

    fireEvent.click(screen.getByText("Generate ZK Proof"));
    act(() => {
      mockProgress = { stage: "loading-zkey", percent: 30 };
      view.rerender(
        <ProofGenerator
          disclosure={mockDisclosure as any}
          onProofGenerated={onProofGenerated}
          onError={onError}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText("Loading Proving Key").length).toBeGreaterThan(
        0,
      );
    });

    await act(async () => {
      resolveProof(mockProof);
    });
  });

  it("maps hook progress to the proof generation stage", async () => {
    let resolveProof!: (proof: typeof mockProof) => void;
    mockGenerateProof.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProof = resolve;
      }),
    );
    const view = renderGenerator();

    fireEvent.click(screen.getByText("Generate ZK Proof"));
    act(() => {
      mockProgress = { stage: "generating", percent: 50 };
      view.rerender(
        <ProofGenerator
          disclosure={mockDisclosure as any}
          onProofGenerated={onProofGenerated}
          onError={onError}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText("Generating Proof").length).toBeGreaterThan(0);
    });

    const svg = document.querySelector("svg")!;
    expect(svg.querySelectorAll("circle")).toHaveLength(12);

    await act(async () => {
      resolveProof(mockProof);
    });
  });

  it("shows complete stage and hides the generate button after success", async () => {
    renderGenerator();

    fireEvent.click(screen.getByText("Generate ZK Proof"));

    await waitFor(() => {
      expect(screen.getByText("Proof Generated")).toBeInTheDocument();
    });
    expect(screen.queryByText("Generate ZK Proof")).not.toBeInTheDocument();
  });

  it("shows error state when proof generation fails", async () => {
    mockGenerateProof.mockRejectedValueOnce(new Error("Circuit error"));
    renderGenerator();

    fireEvent.click(screen.getByText("Generate ZK Proof"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Circuit error");
    });
    expect(screen.getByText("Circuit error")).toBeInTheDocument();
    expect(screen.getByText("Generate ZK Proof")).toBeInTheDocument();
  });

  it("shows generic error message for non-Error throws", async () => {
    mockGenerateProof.mockRejectedValueOnce("string error");
    renderGenerator();

    fireEvent.click(screen.getByText("Generate ZK Proof"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        "Unknown error during proof generation",
      );
    });
    expect(
      screen.getByText("Unknown error during proof generation"),
    ).toBeInTheDocument();
  });

  it("renders inactive circuit nodes with secondary fill in idle stage", () => {
    renderGenerator();

    const svg = document.querySelector("svg")!;
    svg.querySelectorAll("circle").forEach((circle) => {
      expect(circle.getAttribute("fill")).toBe("var(--surface-secondary)");
    });
  });
});
