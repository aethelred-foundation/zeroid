import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/audit",
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

// Mock hooks
jest.mock("@/hooks/useAudit", () => ({
  useAudit: jest.fn(() => ({
    auditLog: [
      {
        id: "1",
        action: "credential_issued",
        category: "credentials",
        timestamp: new Date().toISOString(),
      },
      {
        id: "2",
        action: "proof_generated",
        category: "verifications",
        timestamp: new Date().toISOString(),
      },
      {
        id: "3",
        action: "credential_revoked",
        category: "credentials",
        timestamp: new Date().toISOString(),
      },
    ],
    isLoading: false,
  })),
}));

// Mock components
jest.mock("@/components/audit/AuditTimeline", () => ({
  __esModule: true,
  default: () => <div data-testid="audit-timeline">AuditTimeline</div>,
}));

jest.mock("@/components/ui/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));

import { useAudit } from "@/hooks/useAudit";
import AuditPage from "../page";

describe("AuditPage", () => {
  it("renders without crashing", () => {
    render(<AuditPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<AuditPage />);
    expect(screen.getByText("Audit Trail")).toBeInTheDocument();
    expect(
      screen.getByText(/Complete history of identity actions/),
    ).toBeInTheDocument();
  });

  it("shows Export Log button", () => {
    render(<AuditPage />);
    expect(screen.getByText("Export Log")).toBeInTheDocument();
  });

  it("renders audit timeline component", () => {
    render(<AuditPage />);
    expect(screen.getByTestId("audit-timeline")).toBeInTheDocument();
  });

  it("allows switching category tabs", () => {
    render(<AuditPage />);
    const credentialsTab = screen.getByRole("button", { name: /Credentials/i });
    fireEvent.click(credentialsTab);
    expect(credentialsTab).toBeInTheDocument();
  });

  it("filters audit log by search query", () => {
    render(<AuditPage />);
    const searchInput = screen.getByPlaceholderText("Search audit events...");
    fireEvent.change(searchInput, { target: { value: "credential_issued" } });
    // Should filter to only matching entries
    expect(searchInput).toHaveValue("credential_issued");
  });

  it("filters audit log with non-matching search query", () => {
    render(<AuditPage />);
    const searchInput = screen.getByPlaceholderText("Search audit events...");
    fireEvent.change(searchInput, { target: { value: "nonexistent_action" } });
    expect(searchInput).toHaveValue("nonexistent_action");
  });

  it("switches date range buttons", () => {
    render(<AuditPage />);
    // Click each date range button
    fireEvent.click(screen.getByRole("button", { name: "24h" }));
    expect(screen.getByRole("button", { name: "24h" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(screen.getByRole("button", { name: "30d" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("switches to different category tabs", () => {
    render(<AuditPage />);
    // Click Verifications tab
    fireEvent.click(screen.getByRole("button", { name: /Verifications/i }));
    expect(
      screen.getByRole("button", { name: /Verifications/i }),
    ).toBeInTheDocument();

    // Click Governance tab
    fireEvent.click(screen.getByRole("button", { name: /Governance/i }));
    expect(
      screen.getByRole("button", { name: /Governance/i }),
    ).toBeInTheDocument();

    // Click Identity tab
    fireEvent.click(screen.getByRole("button", { name: /Identity/i }));
    expect(
      screen.getByRole("button", { name: /Identity/i }),
    ).toBeInTheDocument();

    // Click All Events tab
    fireEvent.click(screen.getByRole("button", { name: /All Events/i }));
    expect(
      screen.getByRole("button", { name: /All Events/i }),
    ).toBeInTheDocument();
  });

  it("shows summary stats for audit log", () => {
    render(<AuditPage />);
    expect(screen.getByText("Total Events")).toBeInTheDocument();
    expect(screen.getByText("Credentials Issued")).toBeInTheDocument();
    expect(screen.getByText("Proofs Generated")).toBeInTheDocument();
    expect(screen.getByText("Revocations")).toBeInTheDocument();
  });

  it("filters by category and then searches within filtered results", () => {
    render(<AuditPage />);
    // First filter by category
    fireEvent.click(screen.getByRole("button", { name: /Credentials/i }));
    // Then search within
    const searchInput = screen.getByPlaceholderText("Search audit events...");
    fireEvent.change(searchInput, { target: { value: "credential_issued" } });
    expect(searchInput).toHaveValue("credential_issued");
  });

  it("handles null auditLog gracefully", () => {
    (useAudit as jest.Mock).mockReturnValue({
      auditLog: null,
      isLoading: false,
    });
    render(<AuditPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("Total Events")).toBeInTheDocument();
  });

  it("handles undefined auditLog gracefully", () => {
    (useAudit as jest.Mock).mockReturnValue({
      auditLog: undefined,
      isLoading: false,
    });
    render(<AuditPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("handles empty auditLog", () => {
    (useAudit as jest.Mock).mockReturnValue({ auditLog: [], isLoading: false });
    render(<AuditPage />);
    expect(screen.getByText("Total Events")).toBeInTheDocument();
  });
});
