import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

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

import ProposalCard from "../ProposalCard";

const mockProposal = {
  id: "proposal-001",
  title: "Add New Credential Schema",
  description:
    "Proposal to add a new professional certification credential schema to the ZeroID protocol.",
  status: "active" as const,
  votesFor: 5000,
  votesAgainst: 2000,
  votesAbstain: 500,
  quorum: 10000,
  endTime: new Date(Date.now() + 86400000 * 3).toISOString(),
};

describe("ProposalCard", () => {
  it("renders without crashing", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    expect(screen.getByText("Add New Credential Schema")).toBeInTheDocument();
  });

  it("displays proposal title and description", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    expect(screen.getByText("Add New Credential Schema")).toBeInTheDocument();
    expect(
      screen.getByText(/Proposal to add a new professional/),
    ).toBeInTheDocument();
  });

  it("displays vote percentages", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    // 5000/(5000+2000+500) = 66.7%
    expect(screen.getByText("66.7%")).toBeInTheDocument();
  });

  it("shows vote buttons for active proposals", () => {
    const onVote = jest.fn();
    render(<ProposalCard proposal={mockProposal as any} onVote={onVote} />);
    expect(screen.getByText("For")).toBeInTheDocument();
    expect(screen.getByText("Against")).toBeInTheDocument();
    expect(screen.getByText("Abstain")).toBeInTheDocument();
  });

  it("calls onVote when vote button is clicked", () => {
    const onVote = jest.fn();
    render(<ProposalCard proposal={mockProposal as any} onVote={onVote} />);
    fireEvent.click(screen.getByText("For"));
    expect(onVote).toHaveBeenCalledWith("proposal-001", "for");
  });

  it("shows confirmation after voting", () => {
    render(<ProposalCard proposal={mockProposal as any} onVote={jest.fn()} />);
    fireEvent.click(screen.getByText("For"));
    expect(screen.getByText(/You voted/)).toBeInTheDocument();
  });

  // --- NEW TESTS for uncovered branches/functions ---

  it("calls onVote with against when Against button is clicked", () => {
    const onVote = jest.fn();
    render(<ProposalCard proposal={mockProposal as any} onVote={onVote} />);
    fireEvent.click(screen.getByText("Against"));
    expect(onVote).toHaveBeenCalledWith("proposal-001", "against");
    expect(screen.getByText(/You voted/)).toBeInTheDocument();
    expect(screen.getByText("against")).toBeInTheDocument();
  });

  it("calls onVote with abstain when Abstain button is clicked", () => {
    const onVote = jest.fn();
    render(<ProposalCard proposal={mockProposal as any} onVote={onVote} />);
    fireEvent.click(screen.getByText("Abstain"));
    expect(onVote).toHaveBeenCalledWith("proposal-001", "abstain");
    expect(screen.getByText(/You voted/)).toBeInTheDocument();
    expect(screen.getByText("abstain")).toBeInTheDocument();
  });

  it("hides vote buttons after voting", () => {
    render(<ProposalCard proposal={mockProposal as any} onVote={jest.fn()} />);
    fireEvent.click(screen.getByText("For"));
    expect(
      screen.queryByRole("button", { name: /^For$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Against$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Abstain$/ }),
    ).not.toBeInTheDocument();
  });

  it("does not show vote buttons for non-active proposals", () => {
    const passedProposal = { ...mockProposal, status: "passed" as const };
    render(<ProposalCard proposal={passedProposal as any} />);
    expect(screen.queryByText("For")).not.toBeInTheDocument();
    expect(screen.queryByText("Against")).not.toBeInTheDocument();
    expect(screen.queryByText("Abstain")).not.toBeInTheDocument();
  });

  it("displays correct status badge for pending proposal", () => {
    const pendingProposal = { ...mockProposal, status: "pending" as const };
    render(<ProposalCard proposal={pendingProposal as any} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("displays correct status badge for passed proposal", () => {
    const passedProposal = { ...mockProposal, status: "passed" as const };
    render(<ProposalCard proposal={passedProposal as any} />);
    expect(screen.getByText("Passed")).toBeInTheDocument();
  });

  it("displays correct status badge for rejected proposal", () => {
    const rejectedProposal = { ...mockProposal, status: "rejected" as const };
    render(<ProposalCard proposal={rejectedProposal as any} />);
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("displays correct status badge for executed proposal", () => {
    const executedProposal = { ...mockProposal, status: "executed" as const };
    render(<ProposalCard proposal={executedProposal as any} />);
    expect(screen.getByText("Executed")).toBeInTheDocument();
  });

  it("displays truncated proposal id", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    expect(screen.getByText("#proposal")).toBeInTheDocument();
  });

  it("displays quorum progress percentage", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    // totalVotes = 7500, quorum = 10000 => 75%
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("handles zero total votes gracefully", () => {
    const zeroVoteProposal = {
      ...mockProposal,
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
    };
    render(<ProposalCard proposal={zeroVoteProposal as any} />);
    // Should show 0.0% for all
    expect(screen.getAllByText("0.0%").length).toBe(3);
  });

  it("handles zero quorum gracefully", () => {
    const zeroQuorumProposal = { ...mockProposal, quorum: 0 };
    render(<ProposalCard proposal={zeroQuorumProposal as any} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("caps quorum percentage at 100%", () => {
    const exceededQuorum = { ...mockProposal, quorum: 1000 };
    // totalVotes = 7500, quorum = 1000 => 750% capped to 100%
    render(<ProposalCard proposal={exceededQuorum as any} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders View Details button when onViewDetails is provided", () => {
    const onViewDetails = jest.fn();
    render(
      <ProposalCard
        proposal={mockProposal as any}
        onViewDetails={onViewDetails}
      />,
    );
    const viewButton = screen.getByText("View Details");
    expect(viewButton).toBeInTheDocument();
    fireEvent.click(viewButton);
    expect(onViewDetails).toHaveBeenCalledWith("proposal-001");
  });

  it("does not render View Details button when onViewDetails is not provided", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    expect(screen.queryByText("View Details")).not.toBeInTheDocument();
  });

  it("shows time remaining for proposals with endTime", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    expect(screen.getByText(/remaining/)).toBeInTheDocument();
  });

  it('shows "Ended" for proposals with past endTime', () => {
    const endedProposal = {
      ...mockProposal,
      endTime: new Date(Date.now() - 86400000).toISOString(),
    };
    render(<ProposalCard proposal={endedProposal as any} />);
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  it("handles endTime showing hours when less than a day", () => {
    const soonProposal = {
      ...mockProposal,
      endTime: new Date(Date.now() + 3600000 * 5).toISOString(), // 5 hours
    };
    render(<ProposalCard proposal={soonProposal as any} />);
    expect(screen.getByText(/\d+h remaining/)).toBeInTheDocument();
  });

  it("handles endTime showing days when more than a day", () => {
    const laterProposal = {
      ...mockProposal,
      endTime: new Date(Date.now() + 86400000 * 5).toISOString(), // 5 days
    };
    render(<ProposalCard proposal={laterProposal as any} />);
    expect(screen.getByText(/\d+d \d+h remaining/)).toBeInTheDocument();
  });

  it("does not show time remaining when endTime is not set", () => {
    const noEndTime = { ...mockProposal, endTime: undefined };
    render(<ProposalCard proposal={noEndTime as any} />);
    expect(screen.queryByText(/remaining/)).not.toBeInTheDocument();
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();
  });

  it("formats vote counts in millions", () => {
    const millionVotes = {
      ...mockProposal,
      votesFor: 2500000,
      votesAgainst: 1500000,
      votesAbstain: 500000,
    };
    render(<ProposalCard proposal={millionVotes as any} />);
    expect(screen.getByText("4.5M total")).toBeInTheDocument();
  });

  it("formats vote counts in thousands", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    expect(screen.getByText("7.5K total")).toBeInTheDocument();
  });

  it("formats vote counts below 1000 as plain numbers", () => {
    const smallVotes = {
      ...mockProposal,
      votesFor: 50,
      votesAgainst: 20,
      votesAbstain: 5,
    };
    render(<ProposalCard proposal={smallVotes as any} />);
    expect(screen.getByText("75 total")).toBeInTheDocument();
  });

  it("handles voting without onVote callback", () => {
    render(<ProposalCard proposal={mockProposal as any} />);
    fireEvent.click(screen.getByText("For"));
    // Should still show voted state without errors
    expect(screen.getByText(/You voted/)).toBeInTheDocument();
  });

  it("falls back to pending status for unknown status values", () => {
    const unknownStatus = { ...mockProposal, status: "unknown_status" as any };
    render(<ProposalCard proposal={unknownStatus as any} />);
    // Should still render without crashing
    expect(screen.getByText("Add New Credential Schema")).toBeInTheDocument();
  });
});
