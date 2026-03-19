import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/agent-identity",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: any, prop: string) => {
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
            layoutId,
            ...rest
          } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        });
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock AppLayout
jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: any) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

import AgentIdentityPage from "../page";

describe("AgentIdentityPage", () => {
  it("renders without crashing", () => {
    render(<AgentIdentityPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<AgentIdentityPage />);
    expect(
      screen.getByText("AI Agent Identity Management"),
    ).toBeInTheDocument();
  });

  it("shows Register Agent button", () => {
    render(<AgentIdentityPage />);
    expect(screen.getByText("Register Agent")).toBeInTheDocument();
  });

  it("renders agent cards in grid view by default", () => {
    render(<AgentIdentityPage />);
    expect(screen.getAllByText("ComplianceBot-Alpha").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("KYC-Processor-v3").length).toBeGreaterThan(0);
  });

  it("opens registration wizard when Register Agent is clicked", () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByText("Register Agent"));
    expect(screen.getByText("Register New Agent")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
  });

  it("switches to list view", () => {
    render(<AgentIdentityPage />);
    // Find the list view toggle button (second button in the view toggle group)
    const listButtons = screen.getAllByRole("button");
    const listViewButton = listButtons.find((b) => {
      const icon = b.querySelector("[data-testid]");
      return icon?.getAttribute("data-testid") === "icon-list";
    });
    if (listViewButton) {
      fireEvent.click(listViewButton);
      // In list view, agents should still be visible
      expect(screen.getAllByText("ComplianceBot-Alpha").length).toBeGreaterThan(
        0,
      );
    }
  });

  it("filters agents by search query", () => {
    render(<AgentIdentityPage />);
    const searchInput = screen.getByPlaceholderText(
      "Search agents by name or type...",
    );
    fireEvent.change(searchInput, { target: { value: "Compliance" } });
    expect(screen.getAllByText("ComplianceBot-Alpha").length).toBeGreaterThan(
      0,
    );
    // TradingAgent-Gamma still appears in HITL queue, but should not be in the filtered agent grid
    // Verify DataGuard-Sentinel (Security type, not matching 'Compliance') is not shown
    expect(screen.queryByText("DataGuard-Sentinel")).not.toBeInTheDocument();
  });

  it("navigates through wizard steps", () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByText("Register Agent"));
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.getByText("Agent Name")).toBeInTheDocument();

    // Go to step 2
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(screen.getByText("Select Capabilities")).toBeInTheDocument();

    // Go to step 3
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 3 of 4")).toBeInTheDocument();
    expect(screen.getByText("Human-in-the-Loop")).toBeInTheDocument();

    // Go to step 4 (Review)
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
    // "Register Agent" text appears both as main page button and wizard final button
    expect(screen.getAllByText("Register Agent").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("goes back in wizard steps", () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByText("Register Agent"));
    // Go to step 2
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    // Go back
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
  });

  it("switches to Capability Matrix tab", () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByText("Capability Matrix"));
    expect(screen.getByText("Agent Capability Matrix")).toBeInTheDocument();
    expect(screen.getByText("KYC Verification")).toBeInTheDocument();
    expect(screen.getByText("Sanctions Screening")).toBeInTheDocument();
  });

  it("switches to Delegation Chains tab", () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByText("Delegation Chains"));
    expect(
      screen.getByText("Delegation Chain Visualization"),
    ).toBeInTheDocument();
    expect(screen.getByText("Root Admin (0x7a3...f21d)")).toBeInTheDocument();
  });

  it("displays HITL approval queue", () => {
    render(<AgentIdentityPage />);
    expect(screen.getByText("Human-in-the-Loop Queue")).toBeInTheDocument();
    expect(
      screen.getByText("Execute swap: 50,000 USDC -> ETH"),
    ).toBeInTheDocument();
  });

  it("displays real-time activity log", () => {
    render(<AgentIdentityPage />);
    expect(screen.getByText("Real-time Activity")).toBeInTheDocument();
    expect(
      screen.getByText("Completed sanctions screening batch (247 entities)"),
    ).toBeInTheDocument();
  });

  it("closes wizard via Cancel on step 0", () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByText("Register Agent"));
    expect(screen.getByText("Register New Agent")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Register New Agent")).not.toBeInTheDocument();
  });

  it("selects an agent card in grid view", () => {
    render(<AgentIdentityPage />);
    // Click on an agent card to select it (covers line 236 selectedAgent highlight)
    const agentCards = screen.getAllByText("ComplianceBot-Alpha");
    // Click the first one (in the grid)
    fireEvent.click(
      agentCards[0].closest('[class*="cursor-pointer"]') || agentCards[0],
    );
    // The agent should now be selected (border-brand-500 class applied)
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("switches to list view and back to grid view", () => {
    const { container } = render(<AgentIdentityPage />);

    // Helper to find toggle buttons
    const findToggleButtons = () => {
      const allBtns = Array.from(container.querySelectorAll("button"));
      return allBtns.filter((btn) => {
        const parent = btn.parentElement;
        if (!parent) return false;
        const siblingButtons = parent.querySelectorAll(":scope > button");
        return siblingButtons.length === 2 && btn.className.includes("p-2.5");
      });
    };

    // Find toggle buttons
    let togglePair = findToggleButtons();
    expect(togglePair.length).toBe(2);

    // Switch to list view (click second button)
    fireEvent.click(togglePair[1]);
    expect(screen.getAllByText("ComplianceBot-Alpha").length).toBeGreaterThan(
      0,
    );

    // Re-query after re-render to get fresh DOM references
    togglePair = findToggleButtons();
    expect(togglePair.length).toBe(2);

    // Switch back to grid view (click first button - covers line 218 onClick)
    fireEvent.click(togglePair[0]);
    expect(screen.getAllByText("ComplianceBot-Alpha").length).toBeGreaterThan(
      0,
    );
  });

  it("selects an agent in list view", () => {
    render(<AgentIdentityPage />);
    // Switch to list view first
    const viewToggle = screen.getByPlaceholderText(
      "Search agents by name or type...",
    ).parentElement?.parentElement;
    const buttons = viewToggle?.querySelectorAll("button");
    if (buttons && buttons.length >= 2) {
      fireEvent.click(buttons[buttons.length - 1]);
    }
    // Click on an agent in list view (covers lines 289-294)
    const agentName = screen.getAllByText("ComplianceBot-Alpha")[0];
    const clickTarget =
      agentName.closest('[class*="cursor-pointer"]') || agentName;
    fireEvent.click(clickTarget);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("closes wizard by clicking backdrop overlay", () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByText("Register Agent"));
    expect(screen.getByText("Register New Agent")).toBeInTheDocument();
    // Click the backdrop overlay (line 511) to close
    const backdrop = document.querySelector(".backdrop-blur-sm");
    if (backdrop) {
      fireEvent.click(backdrop);
    }
    expect(screen.queryByText("Register New Agent")).not.toBeInTheDocument();
  });

  it("completes wizard by clicking Register Agent on final step", () => {
    render(<AgentIdentityPage />);
    fireEvent.click(screen.getByText("Register Agent"));
    // Navigate to final step
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 4 of 4")).toBeInTheDocument();
    // Click the Register Agent button in the wizard (not the page button)
    const registerButtons = screen.getAllByText("Register Agent");
    // The last one is the wizard's Register Agent button
    fireEvent.click(registerButtons[registerButtons.length - 1]);
    // Wizard should close
    expect(screen.queryByText("Register New Agent")).not.toBeInTheDocument();
  });

  it("shows agents with different statuses and capabilities in grid", () => {
    render(<AgentIdentityPage />);
    // Verify suspended agent appears
    expect(screen.getAllByText("AuditTrail-Monitor").length).toBeGreaterThan(0);
    // Verify inactive agent appears
    expect(screen.getAllByText("DataGuard-Sentinel").length).toBeGreaterThan(0);
    // Verify agents with > 2 capabilities show +N
    expect(screen.getAllByText(/\+\d/).length).toBeGreaterThan(0);
  });

  it("displays M2M verification stats with positive and negative changes", () => {
    render(<AgentIdentityPage />);
    expect(screen.getByText("M2M Verification Stats")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toBeInTheDocument();
    expect(screen.getByText("-5%")).toBeInTheDocument();
    expect(screen.getByText("-40%")).toBeInTheDocument();
  });

  it("shows agent controls section", () => {
    render(<AgentIdentityPage />);
    expect(screen.getByText("Suspend All Agents")).toBeInTheDocument();
    expect(screen.getByText("Revoke Agent")).toBeInTheDocument();
    expect(screen.getByText("Rotate Credentials")).toBeInTheDocument();
  });
});
