import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ProposalCard from "../ProposalCard";

const schema = {
  id: "12345678-1234-4234-8234-123456789abc",
  name: "Verified Organization",
  version: "1.0.0",
  description: "A proposed organization credential schema.",
  schemaDefinition: {
    type: "object",
    properties: {
      legalName: { type: "string" },
      registrationNumber: { type: "string" },
    },
  },
  proposedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "PROPOSED" as const,
  approvalVotes: 3,
  rejectionVotes: 1,
  voters: [
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ],
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T01:00:00.000Z",
};

describe("ProposalCard", () => {
  it("renders the exact backend schema-governance fields", () => {
    render(<ProposalCard schema={schema} />);

    expect(screen.getByText("Verified Organization")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
    expect(screen.getByTitle(schema.proposedBy)).toHaveTextContent(
      schema.proposedBy,
    );
    expect(screen.getByText("3 approve")).toBeInTheDocument();
    expect(screen.getByText("1 reject")).toBeInTheDocument();
    expect(screen.getAllByText("2", { selector: "dd" })).toHaveLength(2);
    expect(
      screen.getByLabelText("75% approve, 25% reject"),
    ).toBeInTheDocument();
  });

  it("loads detail by the backend UUID", () => {
    const onViewDetails = jest.fn();
    render(
      <ProposalCard schema={schema} onViewDetails={onViewDetails} selected />,
    );

    fireEvent.click(screen.getByRole("button", { name: /review and vote/i }));
    expect(onViewDetails).toHaveBeenCalledWith(schema.id);
  });

  it.each([
    ["DRAFT", "Draft"],
    ["APPROVED", "Approved"],
    ["DEPRECATED", "Deprecated"],
  ] as const)("renders the real %s status", (status, label) => {
    render(<ProposalCard schema={{ ...schema, status }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("does not expose direct, abstain, quorum, or timeline controls", () => {
    render(
      <ProposalCard
        schema={{ ...schema, status: "APPROVED" }}
        onViewDetails={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /view record/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Abstain")).not.toBeInTheDocument();
    expect(screen.queryByText("Quorum")).not.toBeInTheDocument();
    expect(screen.queryByText(/remaining/i)).not.toBeInTheDocument();
  });
});
