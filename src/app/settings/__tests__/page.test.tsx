import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("wagmi", () => ({
  useAccount: jest.fn(() => ({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    isConnected: true,
  })),
  useReadContract: jest.fn(() => ({ data: undefined, isLoading: false })),
  useWriteContract: jest.fn(() => ({
    writeContractAsync: jest.fn(),
    isPending: false,
  })),
  useWaitForTransactionReceipt: jest.fn(() => ({ isLoading: false })),
}));

jest.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: () => <div data-testid="connect-button">Connect</div>,
}));

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return React.forwardRef((props: any, ref: any) => {
          const {
            initial,
            animate,
            exit,
            transition,
            whileHover,
            whileTap,
            variants,
            ...rest
          } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        });
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useAnimation: () => ({ start: jest.fn() }),
  useInView: () => true,
}));

jest.mock("@/components/layout/AppLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

const mockSetTheme = jest.fn();
jest.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme: mockSetTheme }),
}));

jest.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => ({
    identity: { did: "did:aethelred:zeroid:0x1234" },
  }),
}));

import SettingsPage from "../page";

describe("SettingsPage", () => {
  it("renders without crashing", () => {
    render(<SettingsPage />);
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
  });

  it("displays the page heading", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("shows General tab content by default", () => {
    render(<SettingsPage />);
    expect(
      screen.getByText("Manage your account preferences"),
    ).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
  });

  it("switches to Privacy tab", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText("Privacy"));
    expect(
      screen.getByText("Control what data is shared and how"),
    ).toBeInTheDocument();
    expect(screen.getByText("Default Disclosure Mode")).toBeInTheDocument();
  });

  it("switches to Notifications tab", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText("Notifications"));
    expect(
      screen.getByText("Choose what you want to be notified about"),
    ).toBeInTheDocument();
    expect(screen.getByText("Verification Requests")).toBeInTheDocument();
  });

  it("switches to Security tab", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText("Security"));
    expect(
      screen.getByText("Manage security settings for your identity"),
    ).toBeInTheDocument();
    expect(screen.getByText("Recovery Guardians")).toBeInTheDocument();
  });

  it("switches to Advanced tab and shows danger zone", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByText("Advanced"));
    expect(
      screen.getByText("Advanced settings and data management"),
    ).toBeInTheDocument();
    expect(screen.getByText("Danger Zone")).toBeInTheDocument();
    expect(screen.getByText("Delete Identity")).toBeInTheDocument();
  });

  it("calls setTheme when clicking theme buttons", () => {
    render(<SettingsPage />);
    // The theme section has text "Choose your preferred appearance"
    // The theme buttons are siblings inside the same flex container
    // They are inside a div that contains the p1 bg-surface-secondary container
    const allButtons = screen.getAllByRole("button");
    // Tab buttons are: General, Privacy, Notifications, Security, Advanced
    // The remaining buttons in General are the 3 theme toggle buttons
    // Tab buttons have text, theme buttons are icon-only (empty text or whitespace)
    const nonTabButtons = allButtons.filter((btn) => {
      const text = btn.textContent?.trim() || "";
      return ![
        "General",
        "Privacy",
        "Notifications",
        "Security",
        "Advanced",
      ].includes(text);
    });
    // The first 3 non-tab buttons should be theme buttons (light, dark, system)
    expect(nonTabButtons.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(nonTabButtons[0]);
    expect(mockSetTheme).toHaveBeenCalledWith("light");
    fireEvent.click(nonTabButtons[1]);
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
    fireEvent.click(nonTabButtons[2]);
    expect(mockSetTheme).toHaveBeenCalledWith("system");
  });
});
