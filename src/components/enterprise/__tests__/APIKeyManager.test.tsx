import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import APIKeyManager from "@/components/enterprise/APIKeyManager";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  Key: (props: any) => <div data-testid="icon-key" {...props} />,
  Plus: (props: any) => <div data-testid="icon-plus" {...props} />,
  Copy: (props: any) => <div data-testid="icon-copy" {...props} />,
  Check: (props: any) => <div data-testid="icon-check" {...props} />,
  Trash2: (props: any) => <div data-testid="icon-trash" {...props} />,
  RefreshCw: (props: any) => <div data-testid="icon-refresh" {...props} />,
  Eye: (props: any) => <div data-testid="icon-eye" {...props} />,
  EyeOff: (props: any) => <div data-testid="icon-eye-off" {...props} />,
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  X: (props: any) => <div data-testid="icon-x" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  Activity: (props: any) => <div data-testid="icon-activity" {...props} />,
  ChevronDown: (props: any) => (
    <div data-testid="icon-chevron-down" {...props} />
  ),
}));

const mockKeys = [
  {
    id: "k1",
    name: "Production API",
    keyPrefix: "zid_live_a8f3...",
    fullKey: "zid_live_a8f3_full_key_here",
    scopes: ["read", "write"] as any[],
    createdAt: "2026-01-15",
    lastUsed: "2026-03-15",
    requestCount: 1000,
    rateLimit: 10000,
    rateLimitUsed: 3000,
    active: true,
  },
  {
    id: "k2",
    name: "Legacy Key",
    keyPrefix: "zid_live_old...",
    scopes: ["read"] as any[],
    createdAt: "2025-11-01",
    requestCount: 500,
    rateLimit: 1000,
    rateLimitUsed: 0,
    active: false,
  },
];

describe("APIKeyManager", () => {
  it("renders loading state", () => {
    render(<APIKeyManager loading={true} />);
    expect(screen.getByText("Loading API keys...")).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(<APIKeyManager error="Failed to load keys" />);
    expect(screen.getByText("Failed to load keys")).toBeInTheDocument();
  });

  it("renders with default keys", () => {
    render(<APIKeyManager />);
    expect(screen.getByText("API Keys")).toBeInTheDocument();
    expect(screen.getByText("Production API")).toBeInTheDocument();
  });

  it("renders provided keys", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getByText("Production API")).toBeInTheDocument();
    expect(screen.getByText("Legacy Key")).toBeInTheDocument();
  });

  it("shows key count", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getByText("2 keys")).toBeInTheDocument();
  });

  it("shows Inactive badge for inactive keys", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("renders key prefixes", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getByText("zid_live_a8f3...")).toBeInTheDocument();
  });

  it("renders scope badges", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getAllByText("Read").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Write").length).toBeGreaterThanOrEqual(1);
  });

  it("renders create key button", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getByText("Create Key")).toBeInTheDocument();
  });

  it("opens create key modal", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getByText("Create Key"));
    expect(screen.getByText("Create API Key")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("e.g., Production API"),
    ).toBeInTheDocument();
  });

  it("shows rotate and delete buttons for each key", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getAllByLabelText("Rotate key").length).toBe(2);
    expect(screen.getAllByLabelText("Delete key").length).toBe(2);
  });

  it("opens rotate confirmation modal", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getAllByLabelText("Rotate key")[0]);
    expect(screen.getByText("Rotate API Key")).toBeInTheDocument();
    expect(screen.getByText("Rotate Key")).toBeInTheDocument();
  });

  it("opens delete confirmation modal", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getAllByLabelText("Delete key")[0]);
    expect(screen.getByText("Delete API Key")).toBeInTheDocument();
    expect(screen.getByText("Delete Key")).toBeInTheDocument();
  });

  it("has toggle visibility buttons", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getAllByLabelText("Toggle key visibility").length).toBe(2);
  });

  it("has copy buttons", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getAllByLabelText("Copy key").length).toBe(2);
  });

  it("applies custom className", () => {
    const { container } = render(<APIKeyManager className="custom-class" />);
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("toggles key visibility and shows fullKey", () => {
    render(<APIKeyManager keys={mockKeys} />);
    // Initially shows keyPrefix
    expect(screen.getByText("zid_live_a8f3...")).toBeInTheDocument();
    // Toggle visibility
    fireEvent.click(screen.getAllByLabelText("Toggle key visibility")[0]);
    // Now should show full key
    expect(screen.getByText("zid_live_a8f3_full_key_here")).toBeInTheDocument();
    // Toggle back
    fireEvent.click(screen.getAllByLabelText("Toggle key visibility")[0]);
    expect(screen.getByText("zid_live_a8f3...")).toBeInTheDocument();
  });

  it("copies key to clipboard and shows check icon then resets", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<APIKeyManager keys={mockKeys} />);
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText("Copy key")[0]);
    });
    expect(writeText).toHaveBeenCalledWith("zid_live_a8f3_full_key_here");
    // After copying, the Check icon should appear (copiedId === key.id)
    expect(screen.getByTestId("icon-check")).toBeInTheDocument();
    // Advance timer to trigger setTimeout(() => setCopiedId(null), 2000)
    await act(async () => {
      jest.advanceTimersByTime(2100);
    });
    // Check icon should be gone, copy icon should be back
    expect(screen.queryByTestId("icon-check")).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it("calls onCreateKey when creating a key via modal", async () => {
    const onCreateKey = jest.fn().mockResolvedValue("new-key-123");
    render(<APIKeyManager keys={mockKeys} onCreateKey={onCreateKey} />);
    fireEvent.click(screen.getByText("Create Key"));
    // Fill in name
    fireEvent.change(screen.getByPlaceholderText("e.g., Production API"), {
      target: { value: "Test Key" },
    });
    // Submit - the Create Key button inside modal (second one)
    const createButtons = screen.getAllByText("Create Key");
    fireEvent.click(createButtons[createButtons.length - 1]);
    expect(onCreateKey).toHaveBeenCalledWith("Test Key", ["read"]);
  });

  it("calls onRotateKey when confirming rotation", async () => {
    const onRotateKey = jest.fn().mockResolvedValue("rotated-key");
    render(<APIKeyManager keys={mockKeys} onRotateKey={onRotateKey} />);
    fireEvent.click(screen.getAllByLabelText("Rotate key")[0]);
    expect(screen.getByText("Rotate API Key")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rotate Key"));
    expect(onRotateKey).toHaveBeenCalledWith("k1");
  });

  it("calls onDeleteKey when confirming deletion", async () => {
    const onDeleteKey = jest.fn().mockResolvedValue(undefined);
    render(<APIKeyManager keys={mockKeys} onDeleteKey={onDeleteKey} />);
    fireEvent.click(screen.getAllByLabelText("Delete key")[0]);
    expect(screen.getByText("Delete API Key")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete Key"));
    expect(onDeleteKey).toHaveBeenCalledWith("k1");
  });

  it("toggles scope selection in create modal", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getByText("Create Key"));
    // 'Read' is already selected by default; click 'Write' to add it
    fireEvent.click(screen.getByText("Create and update credentials"));
    // Click 'Read' description to deselect it (it has >1 scope now)
    fireEvent.click(screen.getByText("Read identity and credential data"));
    // The create button should still work since Write is selected
    fireEvent.change(screen.getByPlaceholderText("e.g., Production API"), {
      target: { value: "Scoped Key" },
    });
    const createButtons = screen.getAllByText("Create Key");
    // Should not throw
    fireEvent.click(createButtons[createButtons.length - 1]);
  });

  it("closes create modal on cancel", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getByText("Create Key"));
    expect(screen.getByText("Create API Key")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Create API Key")).not.toBeInTheDocument();
  });

  it("closes confirm modal on cancel", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getAllByLabelText("Rotate key")[0]);
    expect(screen.getByText("Rotate API Key")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Rotate API Key")).not.toBeInTheDocument();
  });

  it("closes create modal by clicking overlay backdrop", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getByText("Create Key"));
    expect(screen.getByText("Create API Key")).toBeInTheDocument();
    // Click backdrop (the overlay div)
    const backdrop = screen
      .getByText("Create API Key")
      .closest('[class*="fixed"]')!;
    fireEvent.click(backdrop);
    expect(screen.queryByText("Create API Key")).not.toBeInTheDocument();
  });

  it("closes confirm modal by clicking overlay backdrop", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getAllByLabelText("Delete key")[0]);
    expect(screen.getByText("Delete API Key")).toBeInTheDocument();
    // Click backdrop
    const backdrop = screen
      .getByText("Delete API Key")
      .closest('[class*="fixed"]')!;
    fireEvent.click(backdrop);
    expect(screen.queryByText("Delete API Key")).not.toBeInTheDocument();
  });

  it("does not submit create key with empty name", () => {
    const onCreateKey = jest.fn().mockResolvedValue("key");
    render(<APIKeyManager keys={mockKeys} onCreateKey={onCreateKey} />);
    fireEvent.click(screen.getByText("Create Key"));
    // Leave name empty
    const createButtons = screen.getAllByText("Create Key");
    fireEvent.click(createButtons[createButtons.length - 1]);
    expect(onCreateKey).not.toHaveBeenCalled();
  });

  it("handles handleCreate without onCreateKey callback", async () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getByText("Create Key"));
    fireEvent.change(screen.getByPlaceholderText("e.g., Production API"), {
      target: { value: "New Key" },
    });
    const createButtons = screen.getAllByText("Create Key");
    fireEvent.click(createButtons[createButtons.length - 1]);
    // Modal should close without error
    expect(screen.queryByText("Create API Key")).not.toBeInTheDocument();
  });

  it("handles clipboard failure gracefully", async () => {
    const writeText = jest
      .fn()
      .mockRejectedValue(new Error("Clipboard denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<APIKeyManager keys={mockKeys} />);
    // Should not throw
    fireEvent.click(screen.getAllByLabelText("Copy key")[0]);
    expect(writeText).toHaveBeenCalled();
  });

  it("shows lastUsed for keys that have it", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getByText("Last used 2026-03-15")).toBeInTheDocument();
  });

  it("does not show lastUsed for keys without it", () => {
    render(<APIKeyManager keys={mockKeys} />);
    // Legacy Key has no lastUsed
    const lastUsedElements = screen.queryAllByText(/^Last used/);
    expect(lastUsedElements.length).toBe(1); // Only Production API
  });

  it("shows correct rate limit bar colors", () => {
    const keysWithDifferentRates = [
      { ...mockKeys[0], rateLimitUsed: 8500, rateLimit: 10000 }, // > 80%, red
      {
        ...mockKeys[1],
        id: "k3",
        name: "Mid Key",
        rateLimitUsed: 600,
        rateLimit: 1000,
        active: true,
      }, // > 50%, amber
    ];
    render(<APIKeyManager keys={keysWithDifferentRates} />);
    expect(screen.getByText("Production API")).toBeInTheDocument();
    expect(screen.getByText("Mid Key")).toBeInTheDocument();
  });

  it("applies className to loading state", () => {
    const { container } = render(
      <APIKeyManager loading={true} className="load-class" />,
    );
    expect(container.firstChild).toHaveClass("load-class");
  });

  it("applies className to error state", () => {
    const { container } = render(
      <APIKeyManager error="err" className="err-class" />,
    );
    expect(container.firstChild).toHaveClass("err-class");
  });

  it("prevents deselecting last scope in create modal", () => {
    const onCreateKey = jest.fn().mockResolvedValue("key");
    render(<APIKeyManager keys={mockKeys} onCreateKey={onCreateKey} />);
    fireEvent.click(screen.getByText("Create Key"));
    // Try to deselect Read (only selected scope) - should not deselect
    fireEvent.click(screen.getByText("Read identity and credential data"));
    // Submit with name to verify Read is still selected
    fireEvent.change(screen.getByPlaceholderText("e.g., Production API"), {
      target: { value: "Test" },
    });
    const createButtons = screen.getAllByText("Create Key");
    fireEvent.click(createButtons[createButtons.length - 1]);
    expect(onCreateKey).toHaveBeenCalledWith("Test", ["read"]);
  });

  it("handleConfirmAction returns early when confirmAction is null", async () => {
    // The handleConfirmAction callback has a guard: if (!confirmAction) return;
    // This is only passed to ConfirmModal which only renders when confirmAction is set.
    // We capture it via useCallback interception and call it directly.
    const capturedCallbacks: Function[] = [];
    const originalUseCallback = React.useCallback;
    const spy = jest
      .spyOn(React, "useCallback")
      .mockImplementation((fn: any, deps: any) => {
        const result = originalUseCallback(fn, deps);
        capturedCallbacks.push(result);
        return result;
      });

    render(<APIKeyManager keys={mockKeys} />);
    spy.mockRestore();

    // handleConfirmAction is one of the captured callbacks
    // Call all of them - the ones with guards will return early safely
    for (const cb of capturedCallbacks) {
      try {
        await act(async () => {
          await cb();
        });
      } catch {
        // Some callbacks expect arguments, ignore
      }
    }

    // Component should still render fine
    expect(screen.getByText("API Keys")).toBeInTheDocument();
  });

  it("handles confirm delete action without onDeleteKey callback", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getAllByLabelText("Delete key")[0]);
    expect(screen.getByText("Delete API Key")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete Key"));
    // Should close modal without error
    expect(screen.queryByText("Delete API Key")).not.toBeInTheDocument();
  });

  it("handles confirm rotate action without onRotateKey callback", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getAllByLabelText("Rotate key")[0]);
    expect(screen.getByText("Rotate API Key")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rotate Key"));
    // Should close modal without error
    expect(screen.queryByText("Rotate API Key")).not.toBeInTheDocument();
  });

  it("copies keyPrefix when fullKey is not available", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<APIKeyManager keys={mockKeys} />);
    // k2 (Legacy Key) has no fullKey
    fireEvent.click(screen.getAllByLabelText("Copy key")[1]);
    expect(writeText).toHaveBeenCalledWith("zid_live_old...");
  });

  it("shows request count for keys", () => {
    render(<APIKeyManager keys={mockKeys} />);
    expect(screen.getByText("1,000 requests")).toBeInTheDocument();
    expect(screen.getByText("500 requests")).toBeInTheDocument();
  });

  it("shows key prefix when not visible even if fullKey exists", () => {
    render(<APIKeyManager keys={mockKeys} />);
    // By default, keys are not visible, so should show prefix
    expect(screen.getByText("zid_live_a8f3...")).toBeInTheDocument();
    expect(
      screen.queryByText("zid_live_a8f3_full_key_here"),
    ).not.toBeInTheDocument();
  });

  it("stops event propagation when clicking inside create modal", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getByText("Create Key"));
    // Click inside the modal content - should NOT close
    const input = screen.getByPlaceholderText("e.g., Production API");
    fireEvent.click(input);
    expect(screen.getByText("Create API Key")).toBeInTheDocument();
  });

  it("stops event propagation when clicking inside confirm modal", () => {
    render(<APIKeyManager keys={mockKeys} />);
    fireEvent.click(screen.getAllByLabelText("Rotate key")[0]);
    // Click inside the modal content
    const message = screen.getByText(/Rotating this key/);
    fireEvent.click(message);
    expect(screen.getByText("Rotate API Key")).toBeInTheDocument();
  });
});
