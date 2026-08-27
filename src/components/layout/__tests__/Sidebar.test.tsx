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

// Mock framer-motion — generic across tags (div, span, ...)
jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, tag: string) => {
        const Component = React.forwardRef(
          (
            {
              children,
              ...props
            }: React.PropsWithChildren<Record<string, unknown>>,
            ref: React.Ref<HTMLElement>,
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
            const Tag = tag as keyof React.JSX.IntrinsicElements;
            return React.createElement(
              Tag,
              { ref, ...filteredProps },
              children,
            );
          },
        );
        Component.displayName = `motion.${tag}`;
        return Component;
      },
    },
  ),
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
    ShieldCheck: createIcon("shield-check"),
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
    CheckCircle: createIcon("check-circle"),
    AlertTriangle: createIcon("alert-triangle"),
    Info: createIcon("info"),
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

    it("gives the honest readiness badge priority over decorative chips", () => {
      render(<Sidebar {...defaultProps} mobile />);
      // Gated features surface their readiness state...
      expect(screen.getAllByText("Preview").length).toBeGreaterThanOrEqual(1);
      // ...and the decorative AI/New chips yield the row's single badge slot.
      expect(screen.queryByText("AI")).not.toBeInTheDocument();
      expect(screen.queryByText("New")).not.toBeInTheDocument();
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

  describe("Desktop mode (labeled sidebar)", () => {
    it("renders as a fixed labeled sidebar", () => {
      const { container } = render(<Sidebar {...defaultProps} />);
      const aside = container.querySelector("aside");
      expect(aside).toBeInTheDocument();
      expect(aside?.className).toContain("fixed");
      expect(aside?.className).toContain("sidebar-panel");
    });

    it("renders logo link", () => {
      render(<Sidebar {...defaultProps} />);
      const logoLink = screen.getByAltText("ZeroID").closest("a");
      expect(logoLink).toHaveAttribute("href", "/");
    });

    it("names every destination — labels are visible, not tooltip-only", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Credentials")).toBeInTheDocument();
      NAV_SECTIONS.forEach((section) => {
        expect(
          screen.getAllByText(section.title).length,
        ).toBeGreaterThanOrEqual(1);
      });
    });

    it("keeps aria-labels on nav links", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByLabelText("Dashboard")).toBeInTheDocument();
      expect(screen.getByLabelText("Credentials")).toBeInTheDocument();
    });

    it("renders docs link", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByLabelText("Documentation")).toBeInTheDocument();
    });

    it("shows disconnect when connected", () => {
      const useAccount = require("wagmi").useAccount;
      useAccount.mockReturnValue({ isConnected: true });
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByLabelText("Disconnect")).toBeInTheDocument();
    });

    it("hides disconnect when not connected", () => {
      const useAccount = require("wagmi").useAccount;
      useAccount.mockReturnValue({ isConnected: false });
      render(<Sidebar {...defaultProps} />);
      expect(screen.queryByLabelText("Disconnect")).not.toBeInTheDocument();
    });

    it("calls disconnect when the disconnect row is clicked", () => {
      const disconnect = jest.fn();
      const useAccount = require("wagmi").useAccount;
      const useDisconnect = require("wagmi").useDisconnect;
      useAccount.mockReturnValue({ isConnected: true });
      useDisconnect.mockReturnValue({ disconnect });
      render(<Sidebar {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Disconnect"));
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("marks exactly one row active for the current route", () => {
      const usePathname = require("next/navigation").usePathname;
      usePathname.mockReturnValue("/credentials");
      const { container } = render(<Sidebar {...defaultProps} />);
      const activeItems = container.querySelectorAll(".nav-row-active");
      expect(activeItems.length).toBe(1);
      expect(activeItems[0].textContent).toContain("Credentials");
    });

    it("stays quiet for ready features and labels gated ones honestly", () => {
      render(<Sidebar {...defaultProps} />);
      // Ready states carry no badge noise...
      expect(screen.queryByText("Configured")).not.toBeInTheDocument();
      // ...while preview features remain explicitly labeled.
      expect(screen.getAllByText("Preview").length).toBeGreaterThanOrEqual(1);
    });

    it("applies custom className", () => {
      const { container } = render(
        <Sidebar {...defaultProps} className="sidebar-custom" />,
      );
      const aside = container.querySelector("aside");
      expect(aside?.className).toContain("sidebar-custom");
    });
  });
});
