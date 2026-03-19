import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import VotingPanel from "@/components/governance/VotingPanel";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, onClick, disabled, ...props }: any) => (
      <button onClick={onClick} disabled={disabled} {...props}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  ThumbsUp: (props: any) => <div data-testid="icon-thumbs-up" {...props} />,
  ThumbsDown: (props: any) => <div data-testid="icon-thumbs-down" {...props} />,
  Minus: (props: any) => <div data-testid="icon-minus" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  CheckCircle2: (props: any) => <div data-testid="icon-check" {...props} />,
  AlertCircle: (props: any) => <div data-testid="icon-alert" {...props} />,
  Zap: (props: any) => <div data-testid="icon-zap" {...props} />,
  Users: (props: any) => <div data-testid="icon-users" {...props} />,
  ArrowUpRight: (props: any) => <div data-testid="icon-arrow-up" {...props} />,
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  Info: (props: any) => <div data-testid="icon-info" {...props} />,
}));

const mockVote = jest.fn().mockResolvedValue(undefined);
const mockDelegate = jest.fn().mockResolvedValue(undefined);

const mockGovernanceReturn: any = {
  vote: mockVote,
  delegate: mockDelegate,
  votingPower: 15000,
  delegatedTo: null,
  isLoading: false,
};

jest.mock("@/hooks/useGovernance", () => ({
  useGovernance: () => mockGovernanceReturn,
}));

const activeProposal = {
  id: "prop-abc12345-rest",
  status: "active" as const,
  title: "Test Proposal",
};

const closedProposal = {
  id: "prop-closed-123",
  status: "closed" as const,
  title: "Closed Proposal",
};

describe("VotingPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVote.mockResolvedValue(undefined);
    mockDelegate.mockResolvedValue(undefined);
    mockGovernanceReturn.vote = mockVote;
    mockGovernanceReturn.delegate = mockDelegate;
    mockGovernanceReturn.votingPower = 15000;
    mockGovernanceReturn.delegatedTo = null;
    mockGovernanceReturn.isLoading = false;
  });

  it("renders the panel header", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    expect(screen.getByText("Cast Your Vote")).toBeInTheDocument();
    expect(screen.getByText("Proposal #prop-abc")).toBeInTheDocument();
  });

  it("displays voting power", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    expect(screen.getByText("15,000")).toBeInTheDocument();
    expect(screen.getByText("AETH tokens")).toBeInTheDocument();
  });

  it("renders vote options for active proposal", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    expect(screen.getByText("Vote For")).toBeInTheDocument();
    expect(screen.getByText("Vote Against")).toBeInTheDocument();
    expect(screen.getByText("Abstain")).toBeInTheDocument();
  });

  it("renders submit button (initially disabled)", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    const submitButton = screen.getByText("Submit Vote");
    expect(submitButton.closest("button")).toBeDisabled();
  });

  it("enables submit button when a vote is selected", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Vote For"));
    const submitButton = screen.getByText("Submit Vote");
    expect(submitButton.closest("button")).not.toBeDisabled();
  });

  it("submits vote and shows success state", async () => {
    const onVoteSubmitted = jest.fn();
    render(
      <VotingPanel
        proposal={activeProposal as any}
        onVoteSubmitted={onVoteSubmitted}
      />,
    );
    fireEvent.click(screen.getByText("Vote For"));
    fireEvent.click(screen.getByText("Submit Vote"));

    await waitFor(() => {
      expect(screen.getByText("Vote Submitted")).toBeInTheDocument();
    });

    expect(mockVote).toHaveBeenCalledWith("prop-abc12345-rest", "for");
    expect(onVoteSubmitted).toHaveBeenCalled();
  });

  it("shows inactive message for non-active proposals", () => {
    render(<VotingPanel proposal={closedProposal as any} />);
    expect(
      screen.getByText("Voting is not active for this proposal."),
    ).toBeInTheDocument();
  });

  it("shows delegate button", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    expect(screen.getByText("Delegate")).toBeInTheDocument();
  });

  it("toggles delegation form", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Delegate"));
    expect(
      screen.getByPlaceholderText("0x... delegate address"),
    ).toBeInTheDocument();
    expect(screen.getByText("Delegate Power")).toBeInTheDocument();
  });

  it("calls delegate when delegate power is clicked", async () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Delegate"));
    const input = screen.getByPlaceholderText("0x... delegate address");
    fireEvent.change(input, { target: { value: "0xabc123" } });
    fireEvent.click(screen.getByText("Delegate Power"));

    await waitFor(() => {
      expect(mockDelegate).toHaveBeenCalledWith("0xabc123");
    });
  });

  it("shows error when vote submission fails with Error instance", async () => {
    mockVote.mockRejectedValueOnce(new Error("Insufficient gas"));
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Vote For"));
    fireEvent.click(screen.getByText("Submit Vote"));

    await waitFor(() => {
      expect(screen.getByText("Insufficient gas")).toBeInTheDocument();
    });
  });

  it("shows generic error when vote submission fails with non-Error", async () => {
    mockVote.mockRejectedValueOnce("some string");
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Vote For"));
    fireEvent.click(screen.getByText("Submit Vote"));

    await waitFor(() => {
      expect(screen.getByText("Vote submission failed")).toBeInTheDocument();
    });
  });

  it("shows generic error when delegation fails with non-Error", async () => {
    mockDelegate.mockRejectedValueOnce("delegate error");
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Delegate"));
    const input = screen.getByPlaceholderText("0x... delegate address");
    fireEvent.change(input, { target: { value: "0xabc123" } });
    fireEvent.click(screen.getByText("Delegate Power"));

    await waitFor(() => {
      expect(screen.getByText("Delegation failed")).toBeInTheDocument();
    });
  });

  it("shows error when delegation fails with Error instance", async () => {
    mockDelegate.mockRejectedValueOnce(new Error("Not enough tokens"));
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Delegate"));
    const input = screen.getByPlaceholderText("0x... delegate address");
    fireEvent.change(input, { target: { value: "0xabc123" } });
    fireEvent.click(screen.getByText("Delegate Power"));

    await waitFor(() => {
      expect(screen.getByText("Not enough tokens")).toBeInTheDocument();
    });
  });

  it("does not submit vote when no vote is selected (handleSubmitVote guard)", async () => {
    // Access the React fiber to get the onClick handler from a disabled button
    const { container } = render(
      <VotingPanel proposal={activeProposal as any} />,
    );
    const submitButton = screen.getByText("Submit Vote").closest("button")!;

    // Get the React fiber to access the actual onClick prop
    const fiberKey = Object.keys(submitButton).find((key) =>
      key.startsWith("__reactFiber$"),
    );
    if (fiberKey) {
      const fiber = (submitButton as any)[fiberKey];
      const onClick = fiber?.memoizedProps?.onClick;
      if (onClick) {
        await act(async () => {
          onClick();
        });
      }
    }
    expect(mockVote).not.toHaveBeenCalled();
  });

  it("does not delegate when address is empty", async () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Delegate"));
    // Don't enter address, click Delegate Power
    fireEvent.click(screen.getByText("Delegate Power"));
    expect(mockDelegate).not.toHaveBeenCalled();
  });

  it("shows Submitting Vote... while vote is being submitted", async () => {
    let resolveVote: () => void;
    mockVote.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveVote = resolve;
        }),
    );

    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Vote For"));

    act(() => {
      fireEvent.click(screen.getByText("Submit Vote"));
    });

    expect(screen.getByText("Submitting Vote...")).toBeInTheDocument();

    await act(async () => {
      resolveVote!();
    });
  });

  it("selects Vote Against option", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Vote Against"));
    // The submit button should be enabled
    const submitButton = screen.getByText("Submit Vote").closest("button");
    expect(submitButton).not.toBeDisabled();
  });

  it("selects Abstain option", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Abstain"));
    const submitButton = screen.getByText("Submit Vote").closest("button");
    expect(submitButton).not.toBeDisabled();
  });

  it("toggles delegation form closed", () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Delegate"));
    expect(
      screen.getByPlaceholderText("0x... delegate address"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delegate"));
    expect(
      screen.queryByPlaceholderText("0x... delegate address"),
    ).not.toBeInTheDocument();
  });

  it("submits vote without onVoteSubmitted callback", async () => {
    render(<VotingPanel proposal={activeProposal as any} />);
    fireEvent.click(screen.getByText("Vote Against"));
    fireEvent.click(screen.getByText("Submit Vote"));

    await waitFor(() => {
      expect(screen.getByText("Vote Submitted")).toBeInTheDocument();
    });
    expect(mockVote).toHaveBeenCalledWith("prop-abc12345-rest", "against");
  });

  it("displays delegatedTo address when present", () => {
    mockGovernanceReturn.delegatedTo =
      "0x1234567890abcdef1234567890abcdef12345678";
    render(<VotingPanel proposal={activeProposal as any} />);
    expect(screen.getByText(/Delegated to:/)).toBeInTheDocument();
    expect(screen.getByText("0x1234...5678")).toBeInTheDocument();
  });

  it("displays 0 voting power when votingPower is null", () => {
    mockGovernanceReturn.votingPower = null;
    render(<VotingPanel proposal={activeProposal as any} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
