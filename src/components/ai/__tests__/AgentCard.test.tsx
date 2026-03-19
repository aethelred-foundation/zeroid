import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// Mock framer-motion as pass-through
jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        if (typeof prop === "string") {
          return React.forwardRef((props: any, ref: any) => {
            const {
              initial,
              animate,
              exit,
              transition,
              whileHover,
              whileTap,
              variants,
              layout,
              ...rest
            } = props;
            const Tag = prop as any;
            return <Tag ref={ref} {...rest} />;
          });
        }
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock lucide-react icons
jest.mock(
  "lucide-react",
  () =>
    new Proxy(
      {},
      {
        get: (_target: unknown, prop: string | symbol) => {
          if (prop === "__esModule") return true;
          return (props: any) => (
            <div
              data-testid={`icon-${String(prop).toLowerCase()}`}
              {...props}
            />
          );
        },
      },
    ),
);

import AgentCard from "../AgentCard";

const mockAgent = {
  id: "agent-1",
  did: "did:aethelred:mainnet:0x1234567890abcdef1234567890abcdef",
  name: "Test Agent",
  type: "llm" as const,
  status: "active" as const,
  capabilities: [
    { id: "cap-1", label: "Data Analysis", description: "Analyzes data" },
    { id: "cap-2", label: "Verification", description: "Verifies credentials" },
  ],
  reputationScore: 85,
  activityData: [10, 20, 30, 40, 50, 60, 70],
  humanInTheLoop: true,
  lastActive: Date.now() - 3600000,
  createdAt: Date.now() - 86400000,
  verificationCount: 42,
};

describe("AgentCard", () => {
  it("renders without crashing", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("Test Agent")).toBeInTheDocument();
  });

  it("displays agent name, type label, and status", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("LLM Agent")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("displays capabilities", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("Data Analysis")).toBeInTheDocument();
    expect(screen.getByText("Verification")).toBeInTheDocument();
  });

  it("shows loading skeleton when loading is true", () => {
    const { container } = render(<AgentCard agent={mockAgent} loading />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByText("Test Agent")).not.toBeInTheDocument();
  });

  it("renders compact variant", () => {
    render(<AgentCard agent={mockAgent} compact />);
    expect(screen.getByText("Test Agent")).toBeInTheDocument();
    // Compact mode should not show capabilities section
    expect(screen.queryByText("Capabilities")).not.toBeInTheDocument();
  });

  it("shows Human-in-the-Loop badge when humanInTheLoop is true", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.getByText("Human-in-the-Loop")).toBeInTheDocument();
  });

  it("shows Suspend button for active agents when onSuspend is provided", () => {
    const onSuspend = jest.fn();
    render(<AgentCard agent={mockAgent} onSuspend={onSuspend} />);
    const suspendBtn = screen.getByText("Suspend");
    fireEvent.click(suspendBtn);
    expect(onSuspend).toHaveBeenCalledWith("agent-1");
  });

  it("shows Verify button for non-active agents when onVerify is provided", () => {
    const onVerify = jest.fn();
    const pendingAgent = { ...mockAgent, status: "pending_review" as const };
    render(<AgentCard agent={pendingAgent} onVerify={onVerify} />);
    const verifyBtn = screen.getByText("Verify");
    fireEvent.click(verifyBtn);
    expect(onVerify).toHaveBeenCalledWith("agent-1");
  });

  it("shows Audit button and calls onAudit when clicked", () => {
    const onAudit = jest.fn();
    render(<AgentCard agent={mockAgent} onAudit={onAudit} />);
    const auditBtn = screen.getByText("Audit");
    fireEvent.click(auditBtn);
    expect(onAudit).toHaveBeenCalledWith("agent-1");
  });

  it("copies DID to clipboard and shows check icon temporarily", async () => {
    jest.useFakeTimers();
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<AgentCard agent={mockAgent} />);
    const copyBtn = screen.getByLabelText("Copy DID");

    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(writeTextMock).toHaveBeenCalledWith(mockAgent.did);

    // Check icon should now be visible (copied=true)
    expect(screen.getByTestId("icon-check")).toBeInTheDocument();

    // After 2s the copied state resets
    act(() => {
      jest.advanceTimersByTime(2100);
    });
    expect(screen.getByTestId("icon-copy")).toBeInTheDocument();

    jest.useRealTimers();
  });

  it("handles clipboard copy failure gracefully", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error("fail")) },
    });

    render(<AgentCard agent={mockAgent} />);
    const copyBtn = screen.getByLabelText("Copy DID");
    // Should not throw
    fireEvent.click(copyBtn);
  });

  it("does not truncate short DIDs", () => {
    const shortDidAgent = { ...mockAgent, did: "did:short:123" };
    render(<AgentCard agent={shortDidAgent} />);
    expect(screen.getByText("did:short:123")).toBeInTheDocument();
  });

  it("does not show Human-in-the-Loop badge when humanInTheLoop is false", () => {
    const noHitlAgent = { ...mockAgent, humanInTheLoop: false };
    render(<AgentCard agent={noHitlAgent} />);
    expect(screen.queryByText("Human-in-the-Loop")).not.toBeInTheDocument();
  });

  it("renders delegation chain when delegation is provided", () => {
    const agentWithDelegation = {
      ...mockAgent,
      delegation: {
        delegatorDid: "did:aethelred:mainnet:0xdelegator",
        delegatorName: "Main Admin",
        delegatedAt: Date.now() - 86400000,
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    };
    render(<AgentCard agent={agentWithDelegation} />);
    expect(screen.getByText("Delegation Chain")).toBeInTheDocument();
    expect(screen.getByText("Main Admin")).toBeInTheDocument();
    expect(
      screen.getByText("did:aethelred:mainnet:0xdelegator"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Exp:/)).toBeInTheDocument();
  });

  it("renders delegation chain without expiresAt", () => {
    const agentWithDelegation = {
      ...mockAgent,
      delegation: {
        delegatorDid: "did:aethelred:mainnet:0xdelegator",
        delegatorName: "Main Admin",
        delegatedAt: Date.now() - 86400000,
      },
    };
    render(<AgentCard agent={agentWithDelegation} />);
    expect(screen.getByText("Main Admin")).toBeInTheDocument();
    expect(screen.queryByText(/Exp:/)).not.toBeInTheDocument();
  });

  it("does not show delegation chain when delegation is undefined", () => {
    render(<AgentCard agent={mockAgent} />);
    expect(screen.queryByText("Delegation Chain")).not.toBeInTheDocument();
  });

  it("hides activity sparkline when activityData is empty", () => {
    const noActivityAgent = { ...mockAgent, activityData: [] };
    render(<AgentCard agent={noActivityAgent} />);
    expect(screen.queryByText("Activity (7d)")).not.toBeInTheDocument();
  });

  it("renders autonomous agent type", () => {
    const autoAgent = { ...mockAgent, type: "autonomous" as const };
    render(<AgentCard agent={autoAgent} />);
    expect(screen.getByText("Autonomous")).toBeInTheDocument();
  });

  it("renders bot agent type", () => {
    const botAgent = { ...mockAgent, type: "bot" as const };
    render(<AgentCard agent={botAgent} />);
    expect(screen.getByText("Bot")).toBeInTheDocument();
  });

  it("renders suspended status", () => {
    const suspendedAgent = { ...mockAgent, status: "suspended" as const };
    render(<AgentCard agent={suspendedAgent} />);
    expect(screen.getByText("Suspended")).toBeInTheDocument();
  });

  it("renders inactive status", () => {
    const inactiveAgent = { ...mockAgent, status: "inactive" as const };
    render(<AgentCard agent={inactiveAgent} />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("does not show Suspend button when agent is not active", () => {
    const onSuspend = jest.fn();
    const suspendedAgent = { ...mockAgent, status: "suspended" as const };
    render(<AgentCard agent={suspendedAgent} onSuspend={onSuspend} />);
    expect(screen.queryByText("Suspend")).not.toBeInTheDocument();
  });

  it("does not show Verify button when agent is active", () => {
    const onVerify = jest.fn();
    render(<AgentCard agent={mockAgent} onVerify={onVerify} />);
    expect(screen.queryByText("Verify")).not.toBeInTheDocument();
  });

  it("shows reputation ring with low score color", () => {
    const lowRepAgent = { ...mockAgent, reputationScore: 45 };
    render(<AgentCard agent={lowRepAgent} />);
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("shows reputation ring with medium score color", () => {
    const medRepAgent = { ...mockAgent, reputationScore: 65 };
    render(<AgentCard agent={medRepAgent} />);
    expect(screen.getByText("65")).toBeInTheDocument();
  });

  it("shows reputation ring with exactly 80 score (emerald)", () => {
    const agent80 = { ...mockAgent, reputationScore: 80 };
    render(<AgentCard agent={agent80} />);
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("shows reputation ring with exactly 60 score (amber)", () => {
    const agent60 = { ...mockAgent, reputationScore: 60 };
    render(<AgentCard agent={agent60} />);
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("renders activity sparkline with single data point", () => {
    const singleDataAgent = { ...mockAgent, activityData: [42] };
    render(<AgentCard agent={singleDataAgent} />);
    expect(screen.getByText("Activity (7d)")).toBeInTheDocument();
  });

  it("renders compact variant with different agent types", () => {
    const botAgent = { ...mockAgent, type: "bot" as const };
    render(<AgentCard agent={botAgent} compact />);
    expect(screen.getByText("Test Agent")).toBeInTheDocument();
  });

  it("renders pending_review status label", () => {
    const pendingAgent = { ...mockAgent, status: "pending_review" as const };
    render(<AgentCard agent={pendingAgent} />);
    expect(screen.getByText("Pending Review")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <AgentCard agent={mockAgent} className="custom-class" />,
    );
    // The main container should have the custom class
    expect(container.innerHTML).toContain("custom-class");
  });

  it("applies className to loading state", () => {
    const { container } = render(
      <AgentCard agent={mockAgent} loading className="load-class" />,
    );
    expect(container.innerHTML).toContain("load-class");
  });

  it("applies className to compact state", () => {
    const { container } = render(
      <AgentCard agent={mockAgent} compact className="compact-class" />,
    );
    expect(container.innerHTML).toContain("compact-class");
  });
});
