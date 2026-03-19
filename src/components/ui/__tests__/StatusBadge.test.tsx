import React from "react";
import { render, screen } from "@testing-library/react";
import { StatusBadge, VerificationBadge } from "@/components/ui/StatusBadge";
import type { CredentialStatus } from "@/components/ui/StatusBadge";

// Mock lucide-react icons
jest.mock("lucide-react", () => ({
  CheckCircle: (props: Record<string, unknown>) => (
    <span data-testid="icon-check-circle" {...props} />
  ),
  Clock: (props: Record<string, unknown>) => (
    <span data-testid="icon-clock" {...props} />
  ),
  XCircle: (props: Record<string, unknown>) => (
    <span data-testid="icon-x-circle" {...props} />
  ),
  AlertTriangle: (props: Record<string, unknown>) => (
    <span data-testid="icon-alert-triangle" {...props} />
  ),
  ShieldCheck: (props: Record<string, unknown>) => (
    <span data-testid="icon-shield-check" {...props} />
  ),
  ShieldOff: (props: Record<string, unknown>) => (
    <span data-testid="icon-shield-off" {...props} />
  ),
  Loader2: (props: Record<string, unknown>) => (
    <span data-testid="icon-loader" {...props} />
  ),
}));

describe("StatusBadge", () => {
  const statuses: CredentialStatus[] = [
    "verified",
    "pending",
    "revoked",
    "expired",
    "active",
    "suspended",
    "issuing",
  ];

  it.each(statuses)("renders %s status with correct label", (status) => {
    render(<StatusBadge status={status} />);
    const expectedLabels: Record<CredentialStatus, string> = {
      verified: "Verified",
      pending: "Pending",
      revoked: "Revoked",
      expired: "Expired",
      active: "Active",
      suspended: "Suspended",
      issuing: "Issuing",
    };
    expect(screen.getByText(expectedLabels[status])).toBeInTheDocument();
  });

  it("uses custom label when provided", () => {
    render(<StatusBadge status="verified" label="Custom Label" />);
    expect(screen.getByText("Custom Label")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  it("shows icon by default", () => {
    render(<StatusBadge status="verified" />);
    expect(screen.getByTestId("icon-check-circle")).toBeInTheDocument();
  });

  it("hides icon when showIcon is false", () => {
    render(<StatusBadge status="verified" showIcon={false} />);
    expect(screen.queryByTestId("icon-check-circle")).not.toBeInTheDocument();
  });

  it("shows dot indicator when showDot is true", () => {
    const { container } = render(<StatusBadge status="verified" showDot />);
    // There should be a dot container with two inner spans
    const dotSpans = container.querySelectorAll(
      ".relative.flex.h-1\\.5.w-1\\.5",
    );
    expect(dotSpans.length).toBe(1);
  });

  it("does not show dot by default", () => {
    const { container } = render(<StatusBadge status="verified" />);
    const dotSpans = container.querySelectorAll(
      ".relative.flex.h-1\\.5.w-1\\.5",
    );
    expect(dotSpans.length).toBe(0);
  });

  it("applies animate-ping to dot for pending status", () => {
    const { container } = render(<StatusBadge status="pending" showDot />);
    const pingSpan = container.querySelector(".animate-ping");
    expect(pingSpan).toBeInTheDocument();
  });

  it("applies animate-ping to dot for issuing status", () => {
    const { container } = render(<StatusBadge status="issuing" showDot />);
    const pingSpan = container.querySelector(".animate-ping");
    expect(pingSpan).toBeInTheDocument();
  });

  it("does not apply animate-ping to dot for verified status", () => {
    const { container } = render(<StatusBadge status="verified" showDot />);
    const pingSpan = container.querySelector(".animate-ping");
    expect(pingSpan).not.toBeInTheDocument();
  });

  it("renders sm size", () => {
    const { container } = render(<StatusBadge status="verified" size="sm" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("px-1.5");
  });

  it("renders md size by default", () => {
    const { container } = render(<StatusBadge status="verified" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("px-2.5");
  });

  it("renders lg size", () => {
    const { container } = render(<StatusBadge status="verified" size="lg" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("px-3");
  });

  it("applies custom className", () => {
    const { container } = render(
      <StatusBadge status="verified" className="custom-class" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("custom-class");
  });

  it("renders correct icon for each status", () => {
    const iconMap: Record<string, string> = {
      verified: "icon-check-circle",
      active: "icon-shield-check",
      pending: "icon-clock",
      issuing: "icon-loader",
      revoked: "icon-x-circle",
      expired: "icon-alert-triangle",
      suspended: "icon-shield-off",
    };

    for (const [status, testId] of Object.entries(iconMap)) {
      const { unmount } = render(
        <StatusBadge status={status as CredentialStatus} />,
      );
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("VerificationBadge", () => {
  it("renders verified state", () => {
    render(<VerificationBadge verified={true} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByTestId("icon-shield-check")).toBeInTheDocument();
  });

  it("renders unverified state", () => {
    render(<VerificationBadge verified={false} />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByTestId("icon-shield-off")).toBeInTheDocument();
  });

  it("shows level when verified and level is provided", () => {
    render(<VerificationBadge verified={true} level={3} />);
    expect(screen.getByText("L3")).toBeInTheDocument();
  });

  it("does not show level when level is undefined", () => {
    render(<VerificationBadge verified={true} />);
    expect(screen.queryByText(/^L/)).not.toBeInTheDocument();
  });

  it("does not show level when unverified", () => {
    render(<VerificationBadge verified={false} level={2} />);
    expect(screen.queryByText("L2")).not.toBeInTheDocument();
  });

  it("applies custom className when verified", () => {
    const { container } = render(
      <VerificationBadge verified={true} className="test-class" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("test-class");
  });

  it("applies custom className when unverified", () => {
    const { container } = render(
      <VerificationBadge verified={false} className="test-class" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("test-class");
  });

  it("renders level 0", () => {
    render(<VerificationBadge verified={true} level={0} />);
    expect(screen.getByText("L0")).toBeInTheDocument();
  });
});
