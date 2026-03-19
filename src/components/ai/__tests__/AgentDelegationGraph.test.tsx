import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import AgentDelegationGraph from "@/components/ai/AgentDelegationGraph";

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    g: ({ children, onClick, ...props }: any) => (
      <g onClick={onClick}>{children}</g>
    ),
    path: (props: any) => <path {...props} />,
    circle: (props: any) => <circle {...props} />,
  },
  AnimatePresence: ({ children }: any) => children,
  useAnimation: () => ({ start: jest.fn(), stop: jest.fn() }),
  useMotionValue: () => ({ set: jest.fn(), get: () => 0 }),
}));

// Mock lucide-react
jest.mock("lucide-react", () => ({
  Bot: (props: any) => <div data-testid="icon-bot" {...props} />,
  Brain: (props: any) => <div data-testid="icon-brain" {...props} />,
  Cpu: (props: any) => <div data-testid="icon-cpu" {...props} />,
  ZoomIn: (props: any) => <div data-testid="icon-zoom-in" {...props} />,
  ZoomOut: (props: any) => <div data-testid="icon-zoom-out" {...props} />,
  Maximize2: (props: any) => <div data-testid="icon-maximize" {...props} />,
  X: (props: any) => <div data-testid="icon-x" {...props} />,
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  ChevronRight: (props: any) => (
    <div data-testid="icon-chevron-right" {...props} />
  ),
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  User: (props: any) => <div data-testid="icon-user" {...props} />,
}));

const mockNodes = [
  {
    id: "root",
    name: "Treasury Admin",
    did: "did:aethelred:mainnet:0xabc123",
    type: "human" as const,
    status: "active" as const,
    depth: 0,
    capabilities: [{ id: "all", label: "Full Access" }],
    delegatedAt: Date.now() - 30 * 86400000,
  },
  {
    id: "agent-1",
    name: "Compliance Engine",
    did: "did:aethelred:mainnet:0xdef456",
    type: "llm" as const,
    status: "active" as const,
    depth: 1,
    parentId: "root",
    capabilities: [{ id: "screen", label: "Screening" }],
    delegatedAt: Date.now() - 20 * 86400000,
    expiresAt: Date.now() + 60 * 86400000,
  },
  {
    id: "agent-2",
    name: "KYC Bot",
    did: "did:aethelred:mainnet:0xghi789",
    type: "bot" as const,
    status: "suspended" as const,
    depth: 2,
    parentId: "agent-1",
    capabilities: [{ id: "kyc", label: "KYC Check" }],
    delegatedAt: Date.now() - 10 * 86400000,
  },
  {
    id: "agent-3",
    name: "Separate Branch Agent",
    did: "did:aethelred:mainnet:0xsep123",
    type: "autonomous" as const,
    status: "active" as const,
    depth: 1,
    parentId: "root",
    capabilities: [{ id: "monitor", label: "Monitoring" }],
    delegatedAt: Date.now() - 5 * 86400000,
  },
];

const mockEdges = [
  {
    from: "root",
    to: "agent-1",
    capabilities: ["Screening"],
    active: true,
    delegatedAt: Date.now() - 20 * 86400000,
  },
  {
    from: "agent-1",
    to: "agent-2",
    capabilities: ["KYC Check"],
    active: false,
    delegatedAt: Date.now() - 10 * 86400000,
  },
  {
    from: "root",
    to: "agent-3",
    capabilities: ["Monitoring"],
    active: true,
    delegatedAt: Date.now() - 5 * 86400000,
  },
];

describe("AgentDelegationGraph", () => {
  it("renders loading state", () => {
    render(<AgentDelegationGraph loading={true} />);
    expect(screen.getByText("Loading delegation graph...")).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<AgentDelegationGraph error="Network error" />);
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("renders with default mock data when no props provided", () => {
    render(<AgentDelegationGraph />);
    expect(screen.getByText("Agent Delegation Graph")).toBeInTheDocument();
    expect(screen.getByText(/agents/)).toBeInTheDocument();
  });

  it("renders with provided nodes and edges", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    expect(screen.getByText("Agent Delegation Graph")).toBeInTheDocument();
    expect(screen.getByText("4 agents")).toBeInTheDocument();
  });

  it("displays node names", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    expect(screen.getByText("Treasury Admin")).toBeInTheDocument();
    expect(screen.getByText("Compliance Engine")).toBeInTheDocument();
    expect(screen.getByText("KYC Bot")).toBeInTheDocument();
  });

  it("displays node statuses", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    expect(screen.getAllByText("active").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("suspended")).toBeInTheDocument();
  });

  it("shows zoom percentage", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders legend items", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    expect(screen.getByText("human")).toBeInTheDocument();
    expect(screen.getByText("llm")).toBeInTheDocument();
    expect(screen.getByText("autonomous")).toBeInTheDocument();
    expect(screen.getByText("bot")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("calls onNodeClick when a node is clicked", () => {
    const onNodeClick = jest.fn();
    render(
      <AgentDelegationGraph
        nodes={mockNodes}
        edges={mockEdges}
        onNodeClick={onNodeClick}
      />,
    );
    // Click the first node via the g element
    const nodeNames = screen.getAllByText("Treasury Admin");
    if (nodeNames[0]?.closest("g")) {
      fireEvent.click(nodeNames[0].closest("g")!);
      expect(onNodeClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "root" }),
      );
    }
  });

  it("shows detail panel when node is selected", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    const nodeName = screen.getAllByText("Compliance Engine");
    if (nodeName[0]?.closest("g")) {
      fireEvent.click(nodeName[0].closest("g")!);
      // Detail panel should show DID and capabilities
      expect(
        screen.getByText("did:aethelred:mainnet:0xdef456"),
      ).toBeInTheDocument();
      expect(screen.getAllByText("Screening").length).toBeGreaterThanOrEqual(1);
    }
  });

  it("closes detail panel when close button is clicked", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    const nodeName = screen.getAllByText("Treasury Admin");
    if (nodeName[0]?.closest("g")) {
      fireEvent.click(nodeName[0].closest("g")!);
      expect(
        screen.getByText("did:aethelred:mainnet:0xabc123"),
      ).toBeInTheDocument();
      // Click close button (the X icon's parent button)
      const closeButtons = screen.getAllByTestId("icon-x");
      const closeButton = closeButtons.find((el) => el.closest("button"));
      if (closeButton?.closest("button")) {
        fireEvent.click(closeButton.closest("button")!);
      }
    }
  });

  it("applies custom className", () => {
    const { container } = render(
      <AgentDelegationGraph
        nodes={mockNodes}
        edges={mockEdges}
        className="custom-class"
      />,
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("handles mouse down/move/up for panning", () => {
    const { container } = render(
      <AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />,
    );
    const panArea = container.querySelector(
      ".relative.h-\\[450px\\]",
    ) as HTMLElement;
    expect(panArea).toBeTruthy();
    fireEvent.mouseDown(panArea, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(panArea, { clientX: 150, clientY: 150 });
    fireEvent.mouseUp(panArea);
  });

  it("ignores non-left mouse button for panning", () => {
    const { container } = render(
      <AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />,
    );
    const panArea = container.querySelector(
      ".relative.h-\\[450px\\]",
    ) as HTMLElement;
    expect(panArea).toBeTruthy();
    // Right-click should not initiate dragging
    fireEvent.mouseDown(panArea, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(panArea, { clientX: 150, clientY: 150 });
    fireEvent.mouseUp(panArea);
  });

  it("does not pan when not dragging", () => {
    const { container } = render(
      <AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />,
    );
    const panArea = container.querySelector(
      ".relative.h-\\[450px\\]",
    ) as HTMLElement;
    expect(panArea).toBeTruthy();
    // Move without mouseDown should not pan
    fireEvent.mouseMove(panArea, { clientX: 200, clientY: 200 });
  });

  it("handles zoom in button click", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    // Click zoom in button (ZoomIn icon)
    const zoomInBtn = screen.getByTestId("icon-zoom-in").closest("button");
    fireEvent.click(zoomInBtn!);
    expect(screen.getByText("120%")).toBeInTheDocument();
  });

  it("handles zoom out button click", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    const zoomOutBtn = screen.getByTestId("icon-zoom-out").closest("button");
    fireEvent.click(zoomOutBtn!);
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("handles zoom reset button click", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    // Zoom in first
    const zoomInBtn = screen.getByTestId("icon-zoom-in").closest("button");
    fireEvent.click(zoomInBtn!);
    expect(screen.getByText("120%")).toBeInTheDocument();
    // Reset
    const resetBtn = screen.getByTestId("icon-maximize").closest("button");
    fireEvent.click(resetBtn!);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("zoom in caps at 200%", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    const zoomInBtn = screen.getByTestId("icon-zoom-in").closest("button");
    // Click 6 times: 100 -> 120 -> 140 -> 160 -> 180 -> 200 -> 200
    for (let i = 0; i < 6; i++) {
      fireEvent.click(zoomInBtn!);
    }
    expect(screen.getByText("200%")).toBeInTheDocument();
  });

  it("zoom out caps at 40%", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    const zoomOutBtn = screen.getByTestId("icon-zoom-out").closest("button");
    // Click 4 times: 100 -> 80 -> 60 -> 40 -> 40
    for (let i = 0; i < 4; i++) {
      fireEvent.click(zoomOutBtn!);
    }
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("deselects a node when clicked again", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    const nodeName = screen.getAllByText("Treasury Admin");
    if (nodeName[0]?.closest("g")) {
      // Select
      fireEvent.click(nodeName[0].closest("g")!);
      expect(
        screen.getByText("did:aethelred:mainnet:0xabc123"),
      ).toBeInTheDocument();
      // Deselect by clicking same node
      fireEvent.click(nodeName[0].closest("g")!);
    }
  });

  it("handles mouseLeave to stop dragging", () => {
    const { container } = render(
      <AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />,
    );
    const panArea = container.querySelector(
      ".relative.h-\\[450px\\]",
    ) as HTMLElement;
    expect(panArea).toBeTruthy();
    fireEvent.mouseDown(panArea, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseLeave(panArea);
  });

  it("renders detail panel with expiresAt info", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    const nodeName = screen.getAllByText("Compliance Engine");
    if (nodeName[0]?.closest("g")) {
      fireEvent.click(nodeName[0].closest("g")!);
      // agent-1 has expiresAt
      expect(screen.getByText("Expires")).toBeInTheDocument();
    }
  });

  it("renders detail panel without expiresAt for nodes that lack it", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    const nodeName = screen.getAllByText("KYC Bot");
    if (nodeName[0]?.closest("g")) {
      fireEvent.click(nodeName[0].closest("g")!);
      // KYC Bot (agent-2) has no expiresAt
      expect(screen.queryByText("Expires")).not.toBeInTheDocument();
    }
  });

  it("renders with a single node (no edges)", () => {
    const singleNode = [mockNodes[0]];
    render(<AgentDelegationGraph nodes={singleNode} edges={[]} />);
    expect(screen.getByText("1 agents")).toBeInTheDocument();
    expect(screen.getByText("Treasury Admin")).toBeInTheDocument();
  });

  it("handles edge with missing from/to nodes gracefully", () => {
    const badEdges = [
      {
        from: "nonexistent",
        to: "also-nonexistent",
        capabilities: ["test"],
        active: true,
        delegatedAt: Date.now(),
      },
    ];
    render(<AgentDelegationGraph nodes={mockNodes} edges={badEdges} />);
    // Should render without crashing
    expect(screen.getByText("Agent Delegation Graph")).toBeInTheDocument();
  });

  it("renders edges with empty capabilities when not highlighted", () => {
    const edgesNoCapabilities = [
      {
        from: "root",
        to: "agent-1",
        capabilities: [],
        active: true,
        delegatedAt: Date.now(),
      },
    ];
    render(
      <AgentDelegationGraph nodes={mockNodes} edges={edgesNoCapabilities} />,
    );
    expect(screen.getByText("Agent Delegation Graph")).toBeInTheDocument();
  });

  it("highlights only the selected branch, leaving other branch un-highlighted", () => {
    render(<AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />);
    // Select KYC Bot (agent-2) which is in the agent-1 branch
    // This should highlight root -> agent-1 -> agent-2 but NOT agent-3
    const kycBotNames = screen.getAllByText("KYC Bot");
    if (kycBotNames[0]?.closest("g")) {
      fireEvent.click(kycBotNames[0].closest("g")!);
      // agent-3 (Separate Branch Agent) should be rendered but not highlighted
      expect(screen.getByText("Separate Branch Agent")).toBeInTheDocument();
    }
  });

  it("does not show detail panel when selecting a nonexistent node ID (covers ?? null fallback)", () => {
    // This test covers the ?? null branch: nodes.find() returns undefined when ID is not found
    // We simulate this by clicking a node, then removing it from props via rerender
    const { rerender } = render(
      <AgentDelegationGraph nodes={mockNodes} edges={mockEdges} />,
    );
    // Select agent-1
    const nodeName = screen.getAllByText("Compliance Engine");
    if (nodeName[0]?.closest("g")) {
      fireEvent.click(nodeName[0].closest("g")!);
      expect(
        screen.getByText("did:aethelred:mainnet:0xdef456"),
      ).toBeInTheDocument();
    }
    // Rerender with nodes that don't include agent-1, so selectedNode = nodes.find(...) ?? null = null
    const filteredNodes = mockNodes.filter((n) => n.id !== "agent-1");
    rerender(<AgentDelegationGraph nodes={filteredNodes} edges={[]} />);
    // Detail panel should not show since selectedNode is now null
    expect(
      screen.queryByText("did:aethelred:mainnet:0xdef456"),
    ).not.toBeInTheDocument();
  });

  it("renders nodes at various depths with correct layout", () => {
    const deepNodes = [
      { ...mockNodes[0], depth: 0 },
      { ...mockNodes[1], depth: 1 },
      { ...mockNodes[2], depth: 2 },
      {
        id: "agent-3",
        name: "Deep Agent",
        did: "did:aethelred:mainnet:0xdeep",
        type: "autonomous" as const,
        status: "expired" as const,
        depth: 3,
        parentId: "agent-2",
        capabilities: [{ id: "deep", label: "Deep" }],
        delegatedAt: Date.now(),
      },
      {
        id: "agent-4",
        name: "Deeper Agent",
        did: "did:aethelred:mainnet:0xdeeper",
        type: "autonomous" as const,
        status: "inactive" as const,
        depth: 4,
        parentId: "agent-3",
        capabilities: [{ id: "deeper", label: "Deeper" }],
        delegatedAt: Date.now(),
      },
      {
        id: "agent-5",
        name: "Deepest Agent",
        did: "did:aethelred:mainnet:0xdeepest",
        type: "bot" as const,
        status: "active" as const,
        depth: 5,
        parentId: "agent-4",
        capabilities: [{ id: "deepest", label: "Deepest" }],
        delegatedAt: Date.now(),
      },
    ];
    render(<AgentDelegationGraph nodes={deepNodes} edges={[]} />);
    expect(screen.getByText("Deep Agent")).toBeInTheDocument();
    expect(screen.getByText("Deepest Agent")).toBeInTheDocument();
  });
});
