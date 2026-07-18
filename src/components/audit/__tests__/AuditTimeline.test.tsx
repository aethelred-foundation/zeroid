import React from "react";
import { render, screen } from "@testing-library/react";
import AuditTimeline from "@/components/audit/AuditTimeline";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial,
      animate,
      transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
}));

jest.mock(
  "lucide-react",
  () =>
    new Proxy(
      {},
      {
        get: (_target, name: string) =>
          function MockIcon(props: React.HTMLAttributes<HTMLSpanElement>) {
            return <span data-icon={name} {...props} />;
          },
      },
    ),
);

const records = [
  {
    id: "audit-1",
    action: "CREDENTIAL_ISSUED",
    type: "CREDENTIAL_ISSUED",
    entityType: "credential",
    entityId: "credential-1",
    timestamp: "2026-07-18T08:00:00.000Z",
    description: "Issued by the backend",
    transactionHash: "0xabcdef1234567890",
  },
  {
    id: "audit-2",
    action: "AUTH_LOGIN",
    type: "AUTH_LOGIN",
    entityType: "identity",
    entityId: "identity-1",
    timestamp: undefined,
  },
];

describe("AuditTimeline", () => {
  it("renders an honest loading state", () => {
    render(<AuditTimeline isLoading events={[]} />);
    expect(
      screen.getByText("Loading server audit records..."),
    ).toBeInTheDocument();
  });

  it("renders the endpoint error instead of an empty result", () => {
    render(
      <AuditTimeline
        events={[]}
        error={new Error("Audit endpoint unavailable")}
      />,
    );
    expect(screen.getByText("Audit records unavailable")).toBeInTheDocument();
    expect(screen.getByText("Audit endpoint unavailable")).toBeInTheDocument();
  });

  it("renders the supplied empty-state explanation", () => {
    render(
      <AuditTimeline
        events={[]}
        emptyMessage="No records matched the server filters."
      />,
    );
    expect(
      screen.getByText("No records matched the server filters."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 returned")).toBeInTheDocument();
  });

  it("renders action and resource values derived from returned records", () => {
    render(<AuditTimeline events={records} />);

    expect(screen.getByText("2 returned")).toBeInTheDocument();
    expect(screen.getByText("Credential Issued")).toBeInTheDocument();
    expect(screen.getByText("CREDENTIAL_ISSUED")).toBeInTheDocument();
    expect(
      screen.getByText("Resource: credential / credential-1"),
    ).toBeInTheDocument();
    expect(screen.getByText("Issued by the backend")).toBeInTheDocument();
    expect(
      screen.getByText("Transaction: 0xabcdef1234567890"),
    ).toBeInTheDocument();
  });

  it("formats a valid server timestamp", () => {
    render(<AuditTimeline events={[records[0]]} />);
    expect(screen.getByText("Jul 18, 2026")).toBeInTheDocument();
  });

  it("marks missing and invalid timestamps unavailable without a now fallback", () => {
    render(
      <AuditTimeline
        events={[
          records[1],
          {
            id: "audit-3",
            action: "AUTH_FAILED",
            type: "AUTH_FAILED",
            timestamp: "not-a-date",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Timestamp unavailable")).toHaveLength(2);
  });

  it("interprets numeric Unix timestamps as seconds", () => {
    render(
      <AuditTimeline
        events={[
          {
            id: "audit-unix",
            action: "AUTH_LOGIN",
            type: "AUTH_LOGIN",
            timestamp: 1_700_000_000,
          },
        ]}
      />,
    );

    expect(screen.queryByText("Timestamp unavailable")).not.toBeInTheDocument();
    expect(screen.getByText("Nov 15, 2023")).toBeInTheDocument();
  });

  it("derives an unfamiliar action label instead of substituting another action", () => {
    render(
      <AuditTimeline
        events={[
          {
            id: "audit-custom",
            action: "CUSTOM_BACKEND_ACTION",
            type: "CUSTOM_BACKEND_ACTION",
          },
        ]}
      />,
    );

    expect(screen.getByText("Custom Backend Action")).toBeInTheDocument();
    expect(screen.getByText("CUSTOM_BACKEND_ACTION")).toBeInTheDocument();
    expect(screen.queryByText("Credential Verified")).not.toBeInTheDocument();
  });

  it("marks a missing action unavailable rather than inventing one", () => {
    render(
      <AuditTimeline
        events={[
          {
            id: "audit-malformed",
            type: "",
          },
        ]}
      />,
    );
    expect(screen.getByText("Action unavailable")).toBeInTheDocument();
  });
});
