import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TEEStatusPanel from "@/components/tee/TEEStatusPanel";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

jest.mock("lucide-react", () => ({
  Cpu: (props: any) => <div data-testid="icon-cpu" {...props} />,
  ShieldCheck: (props: any) => (
    <div data-testid="icon-shield-check" {...props} />
  ),
  ShieldAlert: (props: any) => (
    <div data-testid="icon-shield-alert" {...props} />
  ),
  Activity: (props: any) => <div data-testid="icon-activity" {...props} />,
  Server: (props: any) => <div data-testid="icon-server" {...props} />,
  Lock: (props: any) => <div data-testid="icon-lock" {...props} />,
  RefreshCw: (props: any) => <div data-testid="icon-refresh" {...props} />,
  CheckCircle2: (props: any) => <div data-testid="icon-check" {...props} />,
  XCircle: (props: any) => <div data-testid="icon-x-circle" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
}));

const mockRefreshStatus = jest.fn().mockResolvedValue(undefined);

jest.mock("@/hooks/useTEE", () => ({
  useTEE: jest.fn(),
}));

import { useTEE } from "@/hooks/useTEE";
const mockUseTEE = useTEE as jest.Mock;

const mockNodes = [
  { id: "n1", name: "Node Alpha", region: "us-east-1", health: "healthy" },
  { id: "n2", name: "Node Beta", region: "eu-west-1", health: "degraded" },
  { id: "n3", name: "Node Gamma", region: "ap-south-1", health: "offline" },
];

const mockAttestation = {
  status: "verified",
  lastVerified: "2026-03-15T10:00:00Z",
  enclaveId: "enc-abc123def456",
};

describe("TEEStatusPanel", () => {
  beforeEach(() => {
    mockUseTEE.mockReturnValue({
      nodes: mockNodes,
      attestation: mockAttestation,
      isLoading: false,
      error: null,
      refreshStatus: mockRefreshStatus,
    });
  });

  it("renders loading state", () => {
    mockUseTEE.mockReturnValue({
      nodes: [],
      attestation: null,
      isLoading: true,
      error: null,
      refreshStatus: jest.fn(),
    });
    render(<TEEStatusPanel />);
    expect(screen.getByText("Loading TEE status...")).toBeInTheDocument();
  });

  it("renders error state", () => {
    mockUseTEE.mockReturnValue({
      nodes: [],
      attestation: null,
      isLoading: false,
      error: "fail",
      refreshStatus: jest.fn(),
    });
    render(<TEEStatusPanel />);
    expect(screen.getByText("Failed to load TEE status")).toBeInTheDocument();
  });

  it("renders compact mode", () => {
    render(<TEEStatusPanel compact={true} />);
    expect(screen.getByText("TEE Nodes")).toBeInTheDocument();
    expect(screen.getByText("1/3 healthy")).toBeInTheDocument();
  });

  it("renders full mode header", () => {
    render(<TEEStatusPanel />);
    expect(screen.getByText("TEE Status")).toBeInTheDocument();
    expect(
      screen.getByText("Trusted Execution Environment"),
    ).toBeInTheDocument();
  });

  it("renders refresh button", () => {
    render(<TEEStatusPanel />);
    expect(screen.getByText("Refresh")).toBeInTheDocument();
  });

  it("calls refreshStatus when refresh is clicked", async () => {
    render(<TEEStatusPanel />);
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => {
      expect(mockRefreshStatus).toHaveBeenCalled();
    });
  });

  it("renders attestation info", () => {
    render(<TEEStatusPanel />);
    expect(screen.getByText("Attestation")).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText("enc-abc123def456")).toBeInTheDocument();
  });

  it("renders node list", () => {
    render(<TEEStatusPanel />);
    expect(screen.getByText("Node Alpha")).toBeInTheDocument();
    expect(screen.getByText("Node Beta")).toBeInTheDocument();
    expect(screen.getByText("Node Gamma")).toBeInTheDocument();
  });

  it("renders node regions", () => {
    render(<TEEStatusPanel />);
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.getByText("eu-west-1")).toBeInTheDocument();
  });

  it("renders node health statuses", () => {
    render(<TEEStatusPanel />);
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("renders healthy count", () => {
    render(<TEEStatusPanel />);
    expect(screen.getByText(/1\/3 healthy/)).toBeInTheDocument();
  });

  it("renders empty node state", () => {
    mockUseTEE.mockReturnValue({
      nodes: [],
      attestation: null,
      isLoading: false,
      error: null,
      refreshStatus: jest.fn(),
    });
    render(<TEEStatusPanel />);
    expect(screen.getByText("No TEE nodes available")).toBeInTheDocument();
  });

  it("handles null nodes gracefully in full mode", () => {
    mockUseTEE.mockReturnValue({
      nodes: null,
      attestation: null,
      isLoading: false,
      error: null,
      refreshStatus: jest.fn(),
    });
    render(<TEEStatusPanel />);
    expect(screen.getByText(/0\/0 healthy/)).toBeInTheDocument();
    expect(screen.getByText("No TEE nodes available")).toBeInTheDocument();
  });

  it("handles null nodes gracefully in compact mode", () => {
    mockUseTEE.mockReturnValue({
      nodes: null,
      attestation: null,
      isLoading: false,
      error: null,
      refreshStatus: jest.fn(),
    });
    render(<TEEStatusPanel compact={true} />);
    expect(screen.getByText("0/0 healthy")).toBeInTheDocument();
  });

  it("shows all healthy indicator in compact mode when all nodes are healthy", () => {
    const allHealthyNodes = [
      { id: "n1", name: "Node A", region: "us-east-1", health: "healthy" },
      { id: "n2", name: "Node B", region: "eu-west-1", health: "healthy" },
    ];
    mockUseTEE.mockReturnValue({
      nodes: allHealthyNodes,
      attestation: null,
      isLoading: false,
      error: null,
      refreshStatus: jest.fn(),
    });
    render(<TEEStatusPanel compact={true} />);
    expect(screen.getByText("2/2 healthy")).toBeInTheDocument();
  });

  it("shows Never when attestation lastVerified is null", () => {
    const noVerifiedAttestation = {
      status: "pending",
      lastVerified: null,
      enclaveId: "enc-test",
    };
    mockUseTEE.mockReturnValue({
      nodes: mockNodes,
      attestation: noVerifiedAttestation,
      isLoading: false,
      error: null,
      refreshStatus: mockRefreshStatus,
    });
    render(<TEEStatusPanel />);
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("does not render enclave ID when not provided", () => {
    const noEnclaveAttestation = {
      status: "verified",
      lastVerified: "2026-03-15T10:00:00Z",
      enclaveId: null,
    };
    mockUseTEE.mockReturnValue({
      nodes: mockNodes,
      attestation: noEnclaveAttestation,
      isLoading: false,
      error: null,
      refreshStatus: mockRefreshStatus,
    });
    render(<TEEStatusPanel />);
    expect(screen.queryByText("Enclave ID")).not.toBeInTheDocument();
  });

  it("renders unknown health status for nodes with unknown health", () => {
    const unknownNode = [
      {
        id: "n1",
        name: "Unknown Node",
        region: "us-east-1",
        health: "unknown",
      },
    ];
    mockUseTEE.mockReturnValue({
      nodes: unknownNode,
      attestation: null,
      isLoading: false,
      error: null,
      refreshStatus: jest.fn(),
    });
    render(<TEEStatusPanel />);
    expect(screen.getByText("Unknown Node")).toBeInTheDocument();
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("handles refresh completing successfully", async () => {
    const successRefresh = jest.fn().mockResolvedValue(undefined);
    mockUseTEE.mockReturnValue({
      nodes: mockNodes,
      attestation: mockAttestation,
      isLoading: false,
      error: null,
      refreshStatus: successRefresh,
    });
    render(<TEEStatusPanel />);
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => {
      expect(successRefresh).toHaveBeenCalled();
    });
    // After refresh completes, button should not be disabled
    expect(screen.getByText("Refresh")).toBeInTheDocument();
  });
});
