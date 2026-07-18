import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

jest.mock("@/hooks/useAudit", () => ({
  useAudit: jest.fn(),
  exportAuditLog: jest.fn(() => Promise.resolve()),
}));

const mockSignIn = jest.fn();
const mockUseIdentity = jest.fn();

jest.mock("@/contexts/IdentityContext", () => ({
  useIdentity: () => mockUseIdentity(),
}));

jest.mock("@/components/audit/AuditTimeline", () => ({
  __esModule: true,
  default: ({
    events,
    isLoading,
    error,
    emptyMessage,
  }: {
    events: unknown[];
    isLoading: boolean;
    error: Error | null;
    emptyMessage: string;
  }) => (
    <div
      data-testid="audit-timeline"
      data-event-count={events.length}
      data-loading={String(isLoading)}
      data-error={error?.message ?? ""}
    >
      {emptyMessage}
    </div>
  ),
}));

import { exportAuditLog, useAudit } from "@/hooks/useAudit";
import AuditPage from "../page";

const mockUseAudit = useAudit as jest.Mock;
const mockExportAuditLog = exportAuditLog as jest.Mock;

const records = [
  {
    id: "audit-1",
    action: "CREDENTIAL_ISSUED",
    type: "CREDENTIAL_ISSUED",
    entityType: "credential",
    entityId: "credential-1",
    timestamp: "2026-07-18T08:00:00.000Z",
  },
  {
    id: "audit-2",
    action: "AUTH_LOGIN",
    type: "AUTH_LOGIN",
    entityType: "identity",
    entityId: "identity-1",
    timestamp: "2026-07-18T09:00:00.000Z",
  },
  {
    id: "audit-3",
    action: "AUTH_LOGIN",
    type: "AUTH_LOGIN",
    entityType: "identity",
    entityId: "identity-1",
    timestamp: undefined,
  },
];

function defaultHookResult() {
  return {
    auditLog: records,
    events: records,
    total: records.length,
    isConnected: true,
    isLoading: false,
    isSuccess: true,
    error: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignIn.mockResolvedValue(undefined);
  mockUseIdentity.mockReturnValue({
    identity: { isLoading: false, isRegistered: true },
    sessionStatus: "authenticated",
    sessionError: null,
    signIn: mockSignIn,
  });
  mockUseAudit.mockReturnValue(defaultHookResult());
  mockExportAuditLog.mockResolvedValue(undefined);
});

describe("AuditPage", () => {
  it("renders a bounded server-backed audit view", () => {
    render(<AuditPage />);

    expect(screen.getByText("Audit Trail")).toBeInTheDocument();
    expect(
      screen.getByText(/Server-backed identity audit records/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/at most 100 returned records/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Complete history/)).not.toBeInTheDocument();
  });

  it("uses one page-level audit source and passes its records to the timeline", () => {
    render(<AuditPage />);

    expect(mockUseAudit).toHaveBeenCalled();
    expect(screen.getByTestId("audit-timeline")).toHaveAttribute(
      "data-event-count",
      "3",
    );
    const filters = mockUseAudit.mock.calls[0][0];
    expect(mockUseAudit.mock.calls[0][1]).toBe(true);
    expect(filters).toMatchObject({ page: 1, pageSize: 100 });
    expect(filters.entityType).toBeUndefined();
    expect(filters.startDate).toEqual(expect.any(String));
    expect(filters.endDate).toEqual(expect.any(String));
  });

  it("does not enable the audit query before wallet session sign-in", () => {
    mockUseIdentity.mockReturnValue({
      identity: { isLoading: false, isRegistered: true },
      sessionStatus: "sign-in-required",
      sessionError: null,
      signIn: mockSignIn,
    });

    render(<AuditPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with wallet" }),
    );

    expect(mockUseAudit.mock.calls[0][1]).toBe(false);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("audit-timeline")).not.toBeInTheDocument();
  });

  it("sends resource selection to the server filter", () => {
    render(<AuditPage />);

    fireEvent.click(screen.getByRole("button", { name: /Credentials/i }));

    const filters = mockUseAudit.mock.calls.at(-1)?.[0];
    expect(filters).toMatchObject({
      entityType: "credential",
      page: 1,
      pageSize: 100,
    });
  });

  it("sends the selected date range to the server filter", () => {
    render(<AuditPage />);

    fireEvent.click(screen.getByRole("button", { name: "24h" }));

    const filters = mockUseAudit.mock.calls.at(-1)?.[0];
    const rangeMs =
      new Date(filters.endDate).getTime() -
      new Date(filters.startDate).getTime();
    expect(rangeMs).toBe(24 * 60 * 60 * 1000);
  });

  it("derives summaries only from returned records", () => {
    render(<AuditPage />);

    const summary = screen.getByRole("region", {
      name: "Returned record summary",
    });
    expect(within(summary).getByText("Returned records")).toBeInTheDocument();
    expect(within(summary).getByText("Dated records")).toBeInTheDocument();
    expect(
      within(summary).getByText("Distinct action codes"),
    ).toBeInTheDocument();
    expect(within(summary).getByText("Distinct resources")).toBeInTheDocument();
    expect(within(summary).getByText("3")).toBeInTheDocument();
    expect(within(summary).getAllByText("2")).toHaveLength(3);
    expect(screen.queryByText("Proofs Generated")).not.toBeInTheDocument();
  });

  it("exports the active server filter through the audit export endpoint helper", async () => {
    render(<AuditPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /Governance schemas/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => expect(mockExportAuditLog).toHaveBeenCalled());
    expect(mockExportAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "schema",
        page: 1,
        pageSize: 100,
        startDate: expect.any(String),
        endDate: expect.any(String),
      }),
      "json",
    );
  });

  it("keeps loading, error, and empty states honest", () => {
    mockUseAudit.mockReturnValue({
      ...defaultHookResult(),
      auditLog: [],
      total: 0,
      isLoading: true,
      isSuccess: false,
      error: null,
    });
    const { rerender } = render(<AuditPage />);
    expect(screen.getByTestId("audit-timeline")).toHaveAttribute(
      "data-loading",
      "true",
    );
    expect(
      screen.queryByRole("region", { name: "Returned record summary" }),
    ).not.toBeInTheDocument();

    mockUseAudit.mockReturnValue({
      ...defaultHookResult(),
      auditLog: [],
      total: 0,
      isLoading: false,
      isSuccess: false,
      error: new Error("Audit API offline"),
    });
    rerender(<AuditPage />);
    expect(screen.getByTestId("audit-timeline")).toHaveAttribute(
      "data-error",
      "Audit API offline",
    );

    mockUseAudit.mockReturnValue({
      ...defaultHookResult(),
      auditLog: [],
      total: 0,
      isSuccess: true,
    });
    rerender(<AuditPage />);
    expect(screen.getByTestId("audit-timeline")).toHaveTextContent(
      "No audit records were returned for these server filters.",
    );
  });

  it("requires a connected session before export", () => {
    mockUseAudit.mockReturnValue({
      ...defaultHookResult(),
      auditLog: [],
      total: 0,
      isConnected: false,
      isSuccess: false,
    });
    render(<AuditPage />);

    expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
    expect(screen.getByText(/Connect your wallet/)).toBeInTheDocument();
  });
});
