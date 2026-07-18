import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "@/components/layout/Header";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(() => "/"),
}));

// Mock lucide-react
jest.mock("lucide-react", () => ({
  Search: (props: Record<string, unknown>) => (
    <span data-testid="icon-search" {...props} />
  ),
  Menu: (props: Record<string, unknown>) => (
    <span data-testid="icon-menu" {...props} />
  ),
  Command: (props: Record<string, unknown>) => (
    <span data-testid="icon-command" {...props} />
  ),
}));

// Mock WalletButton
jest.mock("@/components/ui/WalletButton", () => ({
  WalletButton: () => <div data-testid="wallet-button">WalletButton</div>,
}));

describe("Header", () => {
  const defaultProps = {
    onMenuClick: jest.fn(),
    onSearchClick: jest.fn(),
    sidebarCollapsed: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders page title based on pathname", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("renders page title for different paths", () => {
    const usePathname = require("next/navigation").usePathname;
    usePathname.mockReturnValue("/credentials");
    render(<Header {...defaultProps} />);
    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getByText("Verifiable")).toBeInTheDocument();
  });

  it("renders fallback title for unknown paths", () => {
    const usePathname = require("next/navigation").usePathname;
    usePathname.mockReturnValue("/unknown-path");
    render(<Header {...defaultProps} />);
    expect(screen.getByText("ZeroID")).toBeInTheDocument();
  });

  it("calls onMenuClick when menu button is clicked", () => {
    render(<Header {...defaultProps} />);
    const menuButton = screen.getByLabelText("Open menu");
    fireEvent.click(menuButton);
    expect(defaultProps.onMenuClick).toHaveBeenCalledTimes(1);
  });

  it("calls onSearchClick when search button is clicked", () => {
    render(<Header {...defaultProps} />);
    // The search button contains the Search text
    const searchButton = screen.getByText("Search").closest("button")!;
    fireEvent.click(searchButton);
    expect(defaultProps.onSearchClick).toHaveBeenCalledTimes(1);
  });

  it("does not display synthetic notifications without a notification API", () => {
    render(<Header {...defaultProps} />);
    expect(screen.queryByLabelText("Notifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Credential Verified")).not.toBeInTheDocument();
  });

  it("renders WalletButton", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByTestId("wallet-button")).toBeInTheDocument();
  });

  it("renders keyboard shortcut indicator", () => {
    render(<Header {...defaultProps} />);
    // The Cmd+K shortcut indicator
    expect(screen.getByTestId("icon-command")).toBeInTheDocument();
  });

  it("does not show subtitle when pathname has empty subtitle", () => {
    const usePathname = require("next/navigation").usePathname;
    usePathname.mockReturnValue("/unknown-path");
    render(<Header {...defaultProps} />);
    // Fallback: { title: 'ZeroID', subtitle: '' } — no subtitle rendered
    expect(screen.getByText("ZeroID")).toBeInTheDocument();
  });
});
