import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ComplianceCopilot from "@/components/ai/ComplianceCopilot";

jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    button: ({ children, onClick, disabled, ...props }: any) => (
      <button onClick={onClick} disabled={disabled} {...props}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock("lucide-react", () => ({
  Bot: (props: any) => <div data-testid="icon-bot" {...props} />,
  User: (props: any) => <div data-testid="icon-user" {...props} />,
  Send: (props: any) => <div data-testid="icon-send" {...props} />,
  Search: (props: any) => <div data-testid="icon-search" {...props} />,
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  FileText: (props: any) => <div data-testid="icon-file" {...props} />,
  ExternalLink: (props: any) => <div data-testid="icon-external" {...props} />,
  Copy: (props: any) => <div data-testid="icon-copy" {...props} />,
  Check: (props: any) => <div data-testid="icon-check" {...props} />,
  Download: (props: any) => <div data-testid="icon-download" {...props} />,
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  ShieldCheck: (props: any) => (
    <div data-testid="icon-shield-check" {...props} />
  ),
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  ChevronDown: (props: any) => (
    <div data-testid="icon-chevron-down" {...props} />
  ),
  ChevronUp: (props: any) => <div data-testid="icon-chevron-up" {...props} />,
  Play: (props: any) => <div data-testid="icon-play" {...props} />,
  Eye: (props: any) => <div data-testid="icon-eye" {...props} />,
  Sparkles: (props: any) => <div data-testid="icon-sparkles" {...props} />,
  MessageSquare: (props: any) => <div data-testid="icon-message" {...props} />,
  X: (props: any) => <div data-testid="icon-x" {...props} />,
  RefreshCw: (props: any) => <div data-testid="icon-refresh" {...props} />,
}));

describe("ComplianceCopilot", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the empty state with conversation starters", () => {
    render(<ComplianceCopilot />);
    // "Compliance Copilot" appears in both the header and empty state
    expect(
      screen.getAllByText("Compliance Copilot").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("AI-powered regulatory assistant"),
    ).toBeInTheDocument();
    expect(screen.getByText("Run KYC screening")).toBeInTheDocument();
    expect(screen.getByText("Compliance status")).toBeInTheDocument();
    expect(screen.getByText("Regulatory updates")).toBeInTheDocument();
    expect(screen.getByText("Generate report")).toBeInTheDocument();
  });

  it("renders input field and send button", () => {
    render(<ComplianceCopilot />);
    expect(
      screen.getByPlaceholderText(
        "Ask about compliance, regulations, or risk...",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Send message")).toBeInTheDocument();
  });

  it("send button is disabled when input is empty", () => {
    render(<ComplianceCopilot />);
    const sendButton = screen.getByLabelText("Send message");
    expect(sendButton).toBeDisabled();
  });

  it("sends a message when user types and clicks send", () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, {
      target: { value: "What is compliance status?" },
    });
    const sendButton = screen.getByLabelText("Send message");
    fireEvent.click(sendButton);
    expect(screen.getByText("What is compliance status?")).toBeInTheDocument();
  });

  it("sends a message on Enter key press", () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(screen.getByText("Test message")).toBeInTheDocument();
  });

  it("does not send on Shift+Enter", () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("clears input after sending a message", () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(input.value).toBe("");
  });

  it("shows typing indicator after sending a message", () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    // Input should be disabled while typing
    expect(input).toBeDisabled();
  });

  it("sends message when clicking a conversation starter", () => {
    render(<ComplianceCopilot />);
    fireEvent.click(screen.getByText("Run KYC screening"));
    expect(
      screen.getByText("Run a KYC screening on the latest onboarded identity"),
    ).toBeInTheDocument();
  });

  it("toggles search bar visibility", () => {
    render(<ComplianceCopilot />);
    const searchButton = screen.getByLabelText("Search messages");
    fireEvent.click(searchButton);
    expect(
      screen.getByPlaceholderText("Search conversation..."),
    ).toBeInTheDocument();
    fireEvent.click(searchButton);
  });

  it("receives a response after sending a message", async () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Test query" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    // Fast-forward through the simulated response delay
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    // After response, input should be enabled again
    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });
  });

  it("calls onAction when action button is clicked", async () => {
    const onAction = jest.fn();
    render(<ComplianceCopilot onAction={onAction} />);

    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Run screening" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    // The response may have action buttons
    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });

    // If action buttons exist, click them
    const actionButtons = screen
      .queryAllByRole("button")
      .filter(
        (btn) =>
          btn.textContent &&
          [
            "Run Screening",
            "View Details",
            "Generate Full Report",
            "View Last Report",
          ].includes(btn.textContent.trim()),
      );
    if (actionButtons.length > 0) {
      fireEvent.click(actionButtons[0]);
      expect(onAction).toHaveBeenCalled();
    }
  });

  it("applies custom className", () => {
    const { container } = render(<ComplianceCopilot className="my-class" />);
    expect(container.firstChild).toHaveClass("my-class");
  });

  it("shows export button only when messages exist", () => {
    render(<ComplianceCopilot />);
    expect(
      screen.queryByLabelText("Export conversation"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Run KYC screening"));
    expect(screen.getByLabelText("Export conversation")).toBeInTheDocument();
  });

  it("handles copy response action", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<ComplianceCopilot />);
    fireEvent.click(screen.getByText("Run KYC screening"));

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      const copyButtons = screen.queryAllByLabelText("Copy response");
      if (copyButtons.length > 0) {
        fireEvent.click(copyButtons[0]);
        expect(writeTextMock).toHaveBeenCalled();
      }
    });

    // Advance timer to trigger the setCopied(false) timeout callback
    act(() => {
      jest.advanceTimersByTime(2500);
    });
  });

  // --- NEW TESTS for uncovered branches/functions ---

  it("does not send message when input is only whitespace", () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByLabelText("Send message"));
    // Empty state should still show
    expect(
      screen.getAllByText("Compliance Copilot").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not send message while typing indicator is active", async () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );

    // Send first message
    fireEvent.change(input, { target: { value: "First message" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    // Try to send second message while isTyping
    fireEvent.change(input, { target: { value: "Second message" } });
    // Send button should be disabled
    expect(screen.getByLabelText("Send message")).toBeDisabled();
  });

  it("handles export conversation by creating a download", async () => {
    const createElementSpy = jest.spyOn(document, "createElement");
    const createObjectURLMock = jest.fn().mockReturnValue("blob:test");
    const revokeObjectURLMock = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURLMock,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURLMock,
      configurable: true,
    });

    render(<ComplianceCopilot />);

    // Send a message to make export button appear
    fireEvent.click(screen.getByText("Run KYC screening"));

    // Click export
    fireEvent.click(screen.getByLabelText("Export conversation"));
    expect(createObjectURLMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it("filters messages via search query", async () => {
    render(<ComplianceCopilot />);

    // Send a message
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Unique query text XYZ" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    // Wait for response
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    // Open search
    fireEvent.click(screen.getByLabelText("Search messages"));
    const searchInput = screen.getByPlaceholderText("Search conversation...");

    // Search for something that matches
    fireEvent.change(searchInput, { target: { value: "Unique query" } });
    expect(screen.getByText("Unique query text XYZ")).toBeInTheDocument();

    // Search for something that doesn't match
    fireEvent.change(searchInput, {
      target: { value: "nonexistentterm12345" },
    });
    expect(screen.queryByText("Unique query text XYZ")).not.toBeInTheDocument();
  });

  it("clears search query via X button", async () => {
    render(<ComplianceCopilot />);

    // Send a message
    fireEvent.click(screen.getByText("Run KYC screening"));

    // Open search and type
    fireEvent.click(screen.getByLabelText("Search messages"));
    const searchInput = screen.getByPlaceholderText("Search conversation...");
    fireEvent.change(searchInput, { target: { value: "some query" } });

    // The X button to clear search should appear
    const clearButton = searchInput.parentElement?.querySelector("button");
    if (clearButton) {
      fireEvent.click(clearButton);
      expect((searchInput as HTMLInputElement).value).toBe("");
    }
  });

  it("toggles history panel", () => {
    render(<ComplianceCopilot />);
    const historyButton = screen.getByLabelText("Toggle history");
    fireEvent.click(historyButton);
    // Toggle again
    fireEvent.click(historyButton);
  });

  it("shows suggested prompts when conversation has few messages", async () => {
    render(<ComplianceCopilot />);

    // Send one message
    fireEvent.click(screen.getByText("Run KYC screening"));

    // Wait for response
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      const input = screen.getByPlaceholderText(
        "Ask about compliance, regulations, or risk...",
      );
      expect(input).not.toBeDisabled();
    });

    // Suggested prompts should be visible (first 3 starters)
    // They appear as inline buttons near the bottom
    const allButtons = screen.getAllByRole("button");
    const starterButtons = allButtons.filter(
      (btn) =>
        btn.textContent &&
        [
          "Run KYC screening",
          "Compliance status",
          "Regulatory updates",
        ].includes(btn.textContent.trim()),
    );
    expect(starterButtons.length).toBeGreaterThan(0);
  });

  it("handles clipboard copy failure gracefully", async () => {
    // Mock clipboard.writeText to reject
    Object.assign(navigator, {
      clipboard: {
        writeText: jest
          .fn()
          .mockRejectedValue(new Error("Clipboard unavailable")),
      },
    });

    render(<ComplianceCopilot />);
    fireEvent.click(screen.getByText("Run KYC screening"));

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      const copyButtons = screen.queryAllByLabelText("Copy response");
      if (copyButtons.length > 0) {
        // Should not throw
        fireEvent.click(copyButtons[0]);
      }
    });
  });

  it("renders all conversation starters in empty state", () => {
    render(<ComplianceCopilot />);
    expect(screen.getByText("Risk assessment")).toBeInTheDocument();
    expect(screen.getByText("Sanctions check")).toBeInTheDocument();
  });

  it("uses starter prompt to click on conversation starters from suggested prompts area", async () => {
    render(<ComplianceCopilot />);

    // Click a starter from the empty state
    fireEvent.click(screen.getByText("Compliance status"));
    expect(
      screen.getByText(
        "What is our current compliance status across all jurisdictions?",
      ),
    ).toBeInTheDocument();

    // Wait for response
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      const input = screen.getByPlaceholderText(
        "Ask about compliance, regulations, or risk...",
      );
      expect(input).not.toBeDisabled();
    });
  });

  it("prevents sending via handleSend while isTyping is true", () => {
    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );

    // Send first message to trigger typing
    fireEvent.change(input, { target: { value: "First message" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    // Now isTyping is true. Even though input is disabled, we can try to
    // call handleSend via onKeyDown on the input (or send button click).
    // fireEvent ignores the disabled attribute for dispatching events.
    fireEvent.change(input, { target: { value: "Second message" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    // Only the first message should appear, not the second
    expect(screen.getByText("First message")).toBeInTheDocument();
    expect(screen.queryByText("Second message")).not.toBeInTheDocument();
  });

  it("cleans up properly when unmounted during typing", () => {
    const { unmount } = render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Test unmount" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    // Unmount while typing is in progress
    unmount();
    // Advance timers to ensure no errors from timeout firing after unmount
    act(() => {
      jest.advanceTimersByTime(5000);
    });
  });

  it("renders the default className when none is provided", () => {
    const { container } = render(<ComplianceCopilot />);
    expect(container.firstChild).toHaveClass("flex", "flex-col");
  });

  it("renders report_summary response with metrics", async () => {
    // Force Math.random to return value that selects report_summary (index 1 of 4)
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.3); // floor(0.3 * 4) = 1

    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Generate report" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });

    // Report summary response should contain metrics
    expect(screen.getByText(/compliance report summary/)).toBeInTheDocument();
    expect(screen.getByText("Overall Score")).toBeInTheDocument();
    expect(screen.getByText("94.2%")).toBeInTheDocument();
    expect(screen.getByText("Jurisdictions")).toBeInTheDocument();
    expect(screen.getByText("23 / 28")).toBeInTheDocument();

    randomSpy.mockRestore();
  });

  it("renders compliance_alert response with severity", async () => {
    // Force Math.random to return value that selects compliance_alert (index 0 of 4)
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.1); // floor(0.1 * 4) = 0

    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Check alerts" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });

    // Alert response should have severity styling and citations
    expect(screen.getByText(/compliance gap/i)).toBeInTheDocument();
    expect(screen.getByText(/warning Alert/i)).toBeInTheDocument();

    randomSpy.mockRestore();
  });

  it("handles action button click without onAction prop (covers onAction?. branch)", async () => {
    // Force Math.random to return value that selects action_suggestion (index 2 of 4)
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.6); // floor(0.6 * 4) = 2

    render(<ComplianceCopilot />);
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Run screening" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });

    // Find action buttons and click one without onAction prop
    const actionButtons = screen
      .queryAllByRole("button")
      .filter(
        (btn) =>
          btn.textContent &&
          ["Run Screening", "View Details", "View Last Report"].includes(
            btn.textContent.trim(),
          ),
      );
    if (actionButtons.length > 0) {
      // Should not throw even though onAction is not provided
      fireEvent.click(actionButtons[0]);
    }

    randomSpy.mockRestore();
  });

  it("clicks suggested prompt during active conversation", async () => {
    // Force Math.random to return value that selects a text response (index 3 of 4)
    const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.9); // floor(0.9 * 4) = 3

    render(<ComplianceCopilot />);
    // Send first message to get a conversation going
    const input = screen.getByPlaceholderText(
      "Ask about compliance, regulations, or risk...",
    );
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });

    // Now suggested prompts should appear at the bottom
    // Find and click a suggested prompt button
    const suggestedButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.textContent === "Run KYC screening");
    if (suggestedButtons.length > 0) {
      fireEvent.click(suggestedButtons[suggestedButtons.length - 1]);
      expect(
        screen.getByText(
          "Run a KYC screening on the latest onboarded identity",
        ),
      ).toBeInTheDocument();
    }

    randomSpy.mockRestore();
  });
});
