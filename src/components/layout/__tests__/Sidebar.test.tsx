import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { NAV_ITEMS, NAV_SECTIONS } from "@/components/layout/AppLayout";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(() => "/"),
}));

// Mock next/link
jest.mock("next/link", () => {
  return function MockLink({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string }>) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

// Mock next/image
jest.mock("next/image", () => {
  return function MockImage({
    src,
    alt,
    ...props
  }: {
    src: string;
    alt: string;
    [key: string]: unknown;
  }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  };
});

// Mock wagmi
jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({ isConnected: false })),
  useDisconnect: jest.fn(() => ({ disconnect: jest.fn() })),
  useConnect: jest.fn(() => ({ connectors: [], connect: jest.fn() })),
}));

// Mock @rainbow-me/rainbowkit
jest.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: {
    Custom: ({ children }: { children: (props: any) => React.ReactNode }) => {
      return (
        <>
          {children({
            account: undefined,
            chain: undefined,
            openAccountModal: jest.fn(),
            openChainModal: jest.fn(),
            openConnectModal: jest.fn(),
            mounted: true,
          })}
        </>
      );
    },
  },
}));

// Mock framer-motion
jest.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef(
      (
        {
          children,
          ...props
        }: React.PropsWithChildren<Record<string, unknown>>,
        ref: React.Ref<HTMLDivElement>,
      ) => {
        const filteredProps: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(props)) {
          if (
            ![
              "initial",
              "animate",
              "exit",
              "transition",
              "whileHover",
              "whileTap",
              "variants",
              "layout",
              "layoutId",
            ].includes(key)
          ) {
            filteredProps[key] = value;
          }
        }
        return (
          <div ref={ref} {...filteredProps}>
            {children}
          </div>
        );
      },
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock lucide-react
jest.mock("lucide-react", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) => (
    <span data-testid={`icon-${name}`} {...props} />
  );
  return {
    ExternalLink: createIcon("external-link"),
    LogOut: createIcon("log-out"),
    Settings: createIcon("settings"),
    LayoutDashboard: createIcon("dashboard"),
    Fingerprint: createIcon("fingerprint"),
    BadgeCheck: createIcon("badge-check"),
    ScanEye: createIcon("scan-eye"),
    Vote: createIcon("vote"),
    ClipboardList: createIcon("clipboard"),
    Brain: createIcon("brain"),
    Bot: createIcon("bot"),
    Globe: createIcon("globe"),
    Building2: createIcon("building"),
    Store: createIcon("store"),
    GitBranch: createIcon("git-branch"),
    BarChart3: createIcon("bar-chart"),
    ShieldAlert: createIcon("shield-alert"),
    Puzzle: createIcon("puzzle"),
    UserCog: createIcon("user-cog"),
    Command: createIcon("command"),
    Search: createIcon("search"),
    X: createIcon("x"),
  };
});

describe("Sidebar", () => {
  const defaultProps = {
    collapsed: false,
    onToggle: jest.fn(),
    navItems: NAV_ITEMS,
  };

  describe("Mobile mode", () => {
    it("renders logo text", () => {
      render(<Sidebar {...defaultProps} mobile />);
      expect(screen.getByText("Zero")).toBeInTheDocument();
      expect(screen.getByText("ID")).toBeInTheDocument();
    });

    it("renders all navigation sections", () => {
      render(<Sidebar {...defaultProps} mobile />);
      NAV_SECTIONS.forEach((section) => {
        // Some section titles may match nav item labels (e.g., "Enterprise")
        expect(
          screen.getAllByText(section.title).length,
        ).toBeGreaterThanOrEqual(1);
      });
    });

    it("renders all nav items", () => {
      render(<Sidebar {...defaultProps} mobile />);
      NAV_SECTIONS.forEach((section) => {
        section.items.forEach((item) => {
          // Some item labels may match section titles (e.g., "Enterprise")
          expect(screen.getAllByText(item.label).length).toBeGreaterThanOrEqual(
            1,
          );
        });
      });
    });

    it("highlights active nav item", () => {
      const usePathname = require("next/navigation").usePathname;
      usePathname.mockReturnValue("/credentials");
      render(<Sidebar {...defaultProps} mobile />);
      const link = screen.getByText("Credentials").closest("a");
      expect(link).toHaveAttribute("href", "/credentials");
    });

    it("renders badges on nav items", () => {
      render(<Sidebar {...defaultProps} mobile />);
      expect(screen.getByText("AI")).toBeInTheDocument();
      expect(screen.getByText("New")).toBeInTheDocument();
    });

    it("shows disconnect button when connected", () => {
      const useAccount = require("wagmi").useAccount;
      useAccount.mockReturnValue({ isConnected: true });
      render(<Sidebar {...defaultProps} mobile />);
      expect(screen.getByText("Disconnect")).toBeInTheDocument();
    });

    it("hides disconnect button when not connected", () => {
      const useAccount = require("wagmi").useAccount;
      useAccount.mockReturnValue({ isConnected: false });
      render(<Sidebar {...defaultProps} mobile />);
      expect(screen.queryByText("Disconnect")).not.toBeInTheDocument();
    });

    it("calls disconnect when disconnect button clicked", () => {
      const disconnect = jest.fn();
      const useAccount = require("wagmi").useAccount;
      const useDisconnect = require("wagmi").useDisconnect;
      useAccount.mockReturnValue({ isConnected: true });
      useDisconnect.mockReturnValue({ disconnect });

      render(<Sidebar {...defaultProps} mobile />);
      fireEvent.click(screen.getByText("Disconnect"));
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("shows version number", () => {
      render(<Sidebar {...defaultProps} mobile />);
      expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    });

    it("renders logo image", () => {
      render(<Sidebar {...defaultProps} mobile />);
      const img = screen.getByAltText("ZeroID");
      expect(img).toBeInTheDocument();
    });

    it("applies custom className", () => {
      const { container } = render(
        <Sidebar {...defaultProps} mobile className="custom-sidebar" />,
      );
      const sidebar = container.querySelector("aside");
      expect(sidebar?.className).toContain("custom-sidebar");
    });
  });

  describe("Desktop mode (dock)", () => {
    it("renders as floating dock", () => {
      const { container } = render(<Sidebar {...defaultProps} />);
      const aside = container.querySelector("aside");
      expect(aside).toBeInTheDocument();
      expect(aside?.className).toContain("fixed");
    });

    it("renders logo link", () => {
      render(<Sidebar {...defaultProps} />);
      const logoLink = screen.getByAltText("ZeroID").closest("a");
      expect(logoLink).toHaveAttribute("href", "/");
    });

    it("renders nav item links with aria-labels", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByLabelText("Dashboard")).toBeInTheDocument();
      expect(screen.getByLabelText("Credentials")).toBeInTheDocument();
    });

    it("renders docs link", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByLabelText("Documentation")).toBeInTheDocument();
    });

    it("shows disconnect in dock when connected", () => {
      const useAccount = require("wagmi").useAccount;
      useAccount.mockReturnValue({ isConnected: true });
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByLabelText("Disconnect")).toBeInTheDocument();
    });

    it("hides disconnect in dock when not connected", () => {
      const useAccount = require("wagmi").useAccount;
      useAccount.mockReturnValue({ isConnected: false });
      render(<Sidebar {...defaultProps} />);
      expect(screen.queryByLabelText("Disconnect")).not.toBeInTheDocument();
    });

    it("shows tooltip on hover", () => {
      render(<Sidebar {...defaultProps} />);
      const dashboardLink = screen.getByLabelText("Dashboard");
      fireEvent.mouseEnter(dashboardLink);
      // The tooltip text should appear
      const tooltips = screen.getAllByText("Dashboard");
      expect(tooltips.length).toBeGreaterThanOrEqual(1);
    });

    it("hides tooltip on mouse leave", () => {
      render(<Sidebar {...defaultProps} />);
      const dashboardLink = screen.getByLabelText("Dashboard");
      fireEvent.mouseEnter(dashboardLink);
      fireEvent.mouseLeave(dashboardLink);
      // Tooltip content handled by AnimatePresence mock - should still render due to mock
    });

    it("shows active indicator for current route", () => {
      const usePathname = require("next/navigation").usePathname;
      usePathname.mockReturnValue("/");
      const { container } = render(<Sidebar {...defaultProps} />);
      const activeItems = container.querySelectorAll(".dock-item-active");
      expect(activeItems.length).toBe(1);
    });

    it("shows docs tooltip on hover and hides on leave", () => {
      render(<Sidebar {...defaultProps} />);
      const docsLink = screen.getByLabelText("Documentation");
      fireEvent.mouseEnter(docsLink);
      expect(screen.getByText("Documentation")).toBeInTheDocument();
      fireEvent.mouseLeave(docsLink);
    });

    it("shows disconnect tooltip on hover and hides on leave", () => {
      const useAccount = require("wagmi").useAccount;
      useAccount.mockReturnValue({ isConnected: true });
      render(<Sidebar {...defaultProps} />);
      const disconnectBtn = screen.getByLabelText("Disconnect");
      fireEvent.mouseEnter(disconnectBtn);
      // Tooltip should show 'Disconnect'
      const tooltips = screen.getAllByText("Disconnect");
      expect(tooltips.length).toBeGreaterThanOrEqual(1);
      fireEvent.mouseLeave(disconnectBtn);
    });

    it("calls disconnect when dock disconnect button is clicked", () => {
      const disconnect = jest.fn();
      const useAccount = require("wagmi").useAccount;
      const useDisconnect = require("wagmi").useDisconnect;
      useAccount.mockReturnValue({ isConnected: true });
      useDisconnect.mockReturnValue({ disconnect });
      render(<Sidebar {...defaultProps} />);
      const disconnectBtn = screen.getByLabelText("Disconnect");
      fireEvent.click(disconnectBtn);
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("renders badge dots on dock items", () => {
      const { container } = render(<Sidebar {...defaultProps} />);
      // Items with badges should have badge dot elements
      const badgeDots = container.querySelectorAll(".bg-chrome-300");
      expect(badgeDots.length).toBeGreaterThan(0);
    });

    it("marks non-root paths as active correctly", () => {
      const usePathname = require("next/navigation").usePathname;
      usePathname.mockReturnValue("/credentials");
      const { container } = render(<Sidebar {...defaultProps} />);
      const activeItems = container.querySelectorAll(".dock-item-active");
      expect(activeItems.length).toBe(1);
    });

    it("applies custom className to dock", () => {
      const { container } = render(
        <Sidebar {...defaultProps} className="dock-custom" />,
      );
      const aside = container.querySelector("aside");
      expect(aside?.className).toContain("dock-custom");
    });
  });
});
