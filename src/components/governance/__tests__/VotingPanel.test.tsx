import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VotingPanel from "@/components/governance/VotingPanel";

const schema = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "Verified Organization",
  version: "1.0.0",
  description: "A proposed organization credential schema.",
  schemaDefinition: {
    type: "object",
    properties: { legalName: { type: "string" } },
  },
  proposedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "PROPOSED" as const,
  approvalVotes: 0,
  rejectionVotes: 0,
  voters: [],
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

describe("VotingPanel", () => {
  it("identifies the database-backed vote and exact schema record", () => {
    render(<VotingPanel schema={schema} onVote={jest.fn()} />);

    expect(screen.getByText(schema.id)).toBeInTheDocument();
    expect(screen.getByText(/proposed by identity/)).toHaveTextContent(
      schema.proposedBy,
    );
    expect(screen.getByText(schema.description)).toBeInTheDocument();
    expect(
      screen.getByText(/does not broadcast a wallet transaction/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/legalName/)).toBeInTheDocument();
  });

  it("exposes only approve and reject choices", () => {
    render(<VotingPanel schema={schema} onVote={jest.fn()} />);

    expect(
      screen.getByRole("button", { name: /approve/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
    expect(screen.queryByText("Abstain")).not.toBeInTheDocument();
    expect(screen.queryByText(/delegate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/voting power/i)).not.toBeInTheDocument();
  });

  it("records an approve vote with the backend UUID", async () => {
    const onVote = jest.fn().mockResolvedValue({
      ...schema,
      approvalVotes: 1,
      voters: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    });
    const onVoteSubmitted = jest.fn();
    render(
      <VotingPanel
        schema={schema}
        onVote={onVote}
        onVoteSubmitted={onVoteSubmitted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /record identity vote/i }),
    );

    await waitFor(() => expect(onVote).toHaveBeenCalledWith(schema.id, true));
    expect(await screen.findByText("Vote recorded")).toBeInTheDocument();
    expect(onVoteSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ approvalVotes: 1 }),
    );
  });

  it("records a reject vote with approve=false", async () => {
    const onVote = jest.fn().mockResolvedValue({
      ...schema,
      rejectionVotes: 1,
    });
    render(<VotingPanel schema={schema} onVote={onVote} />);

    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /record identity vote/i }),
    );

    await waitFor(() => expect(onVote).toHaveBeenCalledWith(schema.id, false));
  });

  it("surfaces backend vote rejection without claiming success", async () => {
    const onVote = jest
      .fn()
      .mockRejectedValue(new Error("Already voted on this schema"));
    render(<VotingPanel schema={schema} onVote={onVote} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /record identity vote/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Already voted on this schema",
    );
    expect(screen.queryByText("Vote recorded")).not.toBeInTheDocument();
  });

  it.each(["DRAFT", "APPROVED", "DEPRECATED"] as const)(
    "closes voting for %s records",
    (status) => {
      render(<VotingPanel schema={{ ...schema, status }} onVote={jest.fn()} />);

      expect(screen.getByText("Voting is not open")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /record identity vote/i }),
      ).not.toBeInTheDocument();
    },
  );

  it("disables vote controls while the API mutation is pending", () => {
    render(<VotingPanel schema={schema} onVote={jest.fn()} isSubmitting />);

    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reject/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /recording vote/i }),
    ).toBeDisabled();
  });
});
