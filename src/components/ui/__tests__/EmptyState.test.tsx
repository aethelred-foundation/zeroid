import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "@/components/ui/EmptyState";

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

// Mock lucide-react icons
jest.mock("lucide-react", () => ({
  Inbox: (props: Record<string, unknown>) => (
    <span data-testid="icon-inbox" {...props} />
  ),
}));

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText("No items found")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<EmptyState title="No items" description="Try adding something" />);
    expect(screen.getByText("Try adding something")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    const { container } = render(<EmptyState title="No items" />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(0);
  });

  it("renders default Inbox icon when no icon provided", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByTestId("icon-inbox")).toBeInTheDocument();
  });

  it("renders custom icon when provided", () => {
    render(
      <EmptyState
        title="Empty"
        icon={<span data-testid="custom-icon">Custom</span>}
      />,
    );
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
    expect(screen.queryByTestId("icon-inbox")).not.toBeInTheDocument();
  });

  it("renders primary action button and handles click", () => {
    const onClick = jest.fn();
    render(
      <EmptyState title="Empty" action={{ label: "Add Item", onClick }} />,
    );
    const button = screen.getByText("Add Item");
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders secondary action button and handles click", () => {
    const onClick = jest.fn();
    render(
      <EmptyState
        title="Empty"
        secondaryAction={{ label: "Learn More", onClick }}
      />,
    );
    const button = screen.getByText("Learn More");
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders both primary and secondary actions", () => {
    const primaryClick = jest.fn();
    const secondaryClick = jest.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: "Primary", onClick: primaryClick }}
        secondaryAction={{ label: "Secondary", onClick: secondaryClick }}
      />,
    );
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Secondary")).toBeInTheDocument();
  });

  it("does not render actions container when no actions", () => {
    const { container } = render(<EmptyState title="Empty" />);
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(0);
  });

  it("renders sm size with correct container class", () => {
    const { container } = render(<EmptyState title="Empty" size="sm" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("py-8");
  });

  it("renders md size by default", () => {
    const { container } = render(<EmptyState title="Empty" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("py-16");
  });

  it("renders lg size", () => {
    const { container } = render(<EmptyState title="Empty" size="lg" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("py-24");
  });

  it("applies custom className", () => {
    const { container } = render(
      <EmptyState title="Empty" className="my-custom" />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("my-custom");
  });
});
