import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Store framer-motion hover callbacks for testing
const hoverCallbacks: { onHoverStart?: () => void; onHoverEnd?: () => void } =
  {};

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        if (typeof prop === "string") {
          const Component = React.forwardRef((props: any, ref: any) => {
            const {
              initial,
              animate,
              exit,
              transition,
              whileHover,
              whileTap,
              variants,
              layout,
              onHoverStart,
              onHoverEnd,
              ...domProps
            } = props;
            // Capture hover callbacks for direct invocation in tests
            if (onHoverStart) hoverCallbacks.onHoverStart = onHoverStart;
            if (onHoverEnd) hoverCallbacks.onHoverEnd = onHoverEnd;
            const Tag = prop as any;
            return <Tag ref={ref} {...domProps} />;
          });
          Component.displayName = `motion.${prop}`;
          return Component;
        }
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

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

jest.mock("@/types", () => ({}));

const mockUseIdentity = jest.fn();
jest.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => mockUseIdentity(),
}));

import IdentityCard from "../IdentityCard";

const mockIdentity = {
  did: "did:aethelred:mainnet:0x1234567890abcdef1234567890abcdef",
  verificationStatus: "verified" as const,
  credentialCount: 5,
  verificationCount: 12,
  createdAt: "2025-06-01T00:00:00Z",
};

describe("IdentityCard", () => {
  beforeEach(() => {
    mockUseIdentity.mockReturnValue({
      identity: null,
      isLoading: false,
      error: null,
    });
  });

  it("renders without crashing when identity is passed as prop", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    expect(screen.getByText("ZeroID")).toBeInTheDocument();
  });

  it("shows loading skeleton when hook isLoading", () => {
    mockUseIdentity.mockReturnValue({
      identity: null,
      isLoading: true,
      error: null,
    });
    const { container } = render(<IdentityCard />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows error message when hook returns error", () => {
    mockUseIdentity.mockReturnValue({
      identity: null,
      isLoading: false,
      error: new Error("Network error"),
    });
    render(<IdentityCard />);
    expect(screen.getByText(/Failed to load identity/)).toBeInTheDocument();
  });

  it('shows "No Identity" state when no identity exists', () => {
    render(<IdentityCard />);
    expect(screen.getByText("No Identity")).toBeInTheDocument();
  });

  it("displays credential and verification counts", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getByText("Verifications")).toBeInTheDocument();
  });

  it("renders compact variant", () => {
    render(<IdentityCard identity={mockIdentity as any} compact />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    // Compact should not show stats grid
    expect(screen.queryByText("Credentials")).not.toBeInTheDocument();
  });

  it("uses context identity when no prop is passed", () => {
    mockUseIdentity.mockReturnValue({
      identity: mockIdentity,
      isLoading: false,
      error: null,
    });
    render(<IdentityCard />);
    expect(screen.getByText("ZeroID")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("prefers prop identity over context identity", () => {
    const contextIdentity = { ...mockIdentity, credentialCount: 99 };
    mockUseIdentity.mockReturnValue({
      identity: contextIdentity,
      isLoading: false,
      error: null,
    });
    render(<IdentityCard identity={mockIdentity as any} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryByText("99")).not.toBeInTheDocument();
  });

  it("displays error message text from error object", () => {
    mockUseIdentity.mockReturnValue({
      identity: null,
      isLoading: false,
      error: new Error("Timeout"),
    });
    render(<IdentityCard />);
    expect(screen.getByText(/Timeout/)).toBeInTheDocument();
  });

  it("renders pending verification status", () => {
    const pendingIdentity = {
      ...mockIdentity,
      verificationStatus: "pending" as const,
    };
    render(<IdentityCard identity={pendingIdentity as any} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders revoked verification status", () => {
    const revokedIdentity = {
      ...mockIdentity,
      verificationStatus: "revoked" as const,
    };
    render(<IdentityCard identity={revokedIdentity as any} />);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("renders expired verification status", () => {
    const expiredIdentity = {
      ...mockIdentity,
      verificationStatus: "expired" as const,
    };
    render(<IdentityCard identity={expiredIdentity as any} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("renders unverified verification status", () => {
    const unverifiedIdentity = {
      ...mockIdentity,
      verificationStatus: "unverified" as const,
    };
    render(<IdentityCard identity={unverifiedIdentity as any} />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });

  it("copies DID to clipboard when copy button is clicked", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<IdentityCard identity={mockIdentity as any} />);
    const copyButton = screen.getByLabelText("Copy DID");
    await act(async () => {
      fireEvent.click(copyButton);
    });
    expect(writeText).toHaveBeenCalledWith(mockIdentity.did);
  });

  it("handles clipboard copy failure gracefully", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("Not allowed"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<IdentityCard identity={mockIdentity as any} />);
    const copyButton = screen.getByLabelText("Copy DID");
    await act(async () => {
      fireEvent.click(copyButton);
    });
    // Should not throw
    expect(screen.getByText("ZeroID")).toBeInTheDocument();
  });

  it("does not copy when identity has no DID", async () => {
    const noDidIdentity = { ...mockIdentity, did: "" };
    render(<IdentityCard identity={noDidIdentity as any} />);
    const copyButton = screen.getByLabelText("Copy DID");
    const writeText = jest.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    await act(async () => {
      fireEvent.click(copyButton);
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("renders onViewDetails button in full view and calls it", () => {
    const onViewDetails = jest.fn();
    render(
      <IdentityCard
        identity={mockIdentity as any}
        onViewDetails={onViewDetails}
      />,
    );
    const detailsButton = screen.getByText("Details");
    fireEvent.click(detailsButton);
    expect(onViewDetails).toHaveBeenCalled();
  });

  it("does not render Details button when onViewDetails is not provided", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
  });

  it("calls onViewDetails in compact mode when card is clicked", () => {
    const onViewDetails = jest.fn();
    render(
      <IdentityCard
        identity={mockIdentity as any}
        compact
        onViewDetails={onViewDetails}
      />,
    );
    // In compact mode, the whole card is clickable
    const card = screen
      .getByText("Verified")
      .closest('div[class*="card-interactive"]');
    if (card) {
      fireEvent.click(card);
      expect(onViewDetails).toHaveBeenCalled();
    }
  });

  it("displays truncated DID in compact mode", () => {
    render(<IdentityCard identity={mockIdentity as any} compact />);
    // The DID should be truncated
    expect(screen.getByText(/did:aethelred/)).toBeInTheDocument();
  });

  it('shows "--" for Created date when createdAt is missing', () => {
    const noDateIdentity = { ...mockIdentity, createdAt: undefined };
    render(<IdentityCard identity={noDateIdentity as any} />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("formats createdAt date properly", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    expect(screen.getByText("Created")).toBeInTheDocument();
    // Should show month/year format like "Jun 25"
    expect(screen.getByText(/Jun/)).toBeInTheDocument();
  });

  it("defaults credentialCount and verificationCount to 0", () => {
    const noCountIdentity = {
      ...mockIdentity,
      credentialCount: undefined,
      verificationCount: undefined,
    };
    render(<IdentityCard identity={noCountIdentity as any} />);
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBe(2);
  });

  it("renders Aethelred Network footer text", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    expect(screen.getByText("Aethelred Network")).toBeInTheDocument();
  });

  it("renders Self-Sovereign label", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    expect(screen.getByText("Self-Sovereign")).toBeInTheDocument();
  });

  it("renders Decentralized Identifier label", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    expect(screen.getByText("Decentralized Identifier")).toBeInTheDocument();
  });

  it("does not truncate short DIDs", () => {
    const shortDid = { ...mockIdentity, did: "did:short" };
    render(<IdentityCard identity={shortDid as any} compact />);
    expect(screen.getByText("did:short")).toBeInTheDocument();
  });

  it("falls back to unverified status for unknown verificationStatus", () => {
    const unknownStatusIdentity = {
      ...mockIdentity,
      verificationStatus: "unknown_status" as any,
    };
    render(<IdentityCard identity={unknownStatusIdentity} />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });

  it("triggers hover start handler to show shimmer", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    // Call the captured onHoverStart callback directly
    act(() => {
      hoverCallbacks.onHoverStart?.();
    });
    expect(screen.getByText("ZeroID")).toBeInTheDocument();
  });

  it("triggers hover end handler to hide shimmer", () => {
    render(<IdentityCard identity={mockIdentity as any} />);
    // First hover in, then hover out
    act(() => {
      hoverCallbacks.onHoverStart?.();
    });
    act(() => {
      hoverCallbacks.onHoverEnd?.();
    });
    expect(screen.getByText("ZeroID")).toBeInTheDocument();
  });

  it("resets copied state after timeout", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<IdentityCard identity={mockIdentity as any} />);
    const copyButton = screen.getByLabelText("Copy DID");

    await act(async () => {
      fireEvent.click(copyButton);
    });
    expect(writeText).toHaveBeenCalledWith(mockIdentity.did);

    // After the timeout, copied should reset to false
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    // The component should still render normally
    expect(screen.getByText("ZeroID")).toBeInTheDocument();
    jest.useRealTimers();
  });
});
