import React from "react";
import { render } from "@testing-library/react";
import {
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTable,
  SkeletonMetric,
  SkeletonBadge,
  SkeletonStats,
  SkeletonLine,
} from "@/components/ui/Skeleton";

describe("SkeletonText", () => {
  it("renders default 3 lines", () => {
    const { container } = render(<SkeletonText />);
    const lines = container.querySelectorAll(".animate-pulse");
    expect(lines.length).toBe(3);
  });

  it("renders specified number of lines", () => {
    const { container } = render(<SkeletonText lines={5} />);
    const lines = container.querySelectorAll(".animate-pulse");
    expect(lines.length).toBe(5);
  });

  it("renders single line", () => {
    const { container } = render(<SkeletonText lines={1} />);
    const lines = container.querySelectorAll(".animate-pulse");
    expect(lines.length).toBe(1);
  });

  it("sets aria-hidden to true", () => {
    const { container } = render(<SkeletonText />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom className", () => {
    const { container } = render(<SkeletonText className="custom" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("custom");
  });

  it("first line has 90% width", () => {
    const { container } = render(<SkeletonText lines={3} />);
    const lines = container.querySelectorAll(".animate-pulse");
    expect(lines[0]).toHaveStyle({ width: "90%" });
  });

  it("last line has 60% width", () => {
    const { container } = render(<SkeletonText lines={3} />);
    const lines = container.querySelectorAll(".animate-pulse");
    expect(lines[2]).toHaveStyle({ width: "60%" });
  });

  it("middle lines have 100% width", () => {
    const { container } = render(<SkeletonText lines={3} />);
    const lines = container.querySelectorAll(".animate-pulse");
    expect(lines[1]).toHaveStyle({ width: "100%" });
  });
});

describe("SkeletonAvatar", () => {
  it("renders with default size 40", () => {
    const { container } = render(<SkeletonAvatar />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveStyle({ width: "40px", height: "40px" });
  });

  it("renders with custom size", () => {
    const { container } = render(<SkeletonAvatar size={64} />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveStyle({ width: "64px", height: "64px" });
  });

  it("has rounded-full class", () => {
    const { container } = render(<SkeletonAvatar />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar.className).toContain("rounded-full");
  });

  it("sets aria-hidden", () => {
    const { container } = render(<SkeletonAvatar />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom className", () => {
    const { container } = render(<SkeletonAvatar className="extra" />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar.className).toContain("extra");
  });
});

describe("SkeletonCard", () => {
  it("renders with default height 12rem", () => {
    const { container } = render(<SkeletonCard />);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveStyle({ height: "12rem" });
  });

  it("renders with custom height", () => {
    const { container } = render(<SkeletonCard height="20rem" />);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveStyle({ height: "20rem" });
  });

  it("sets aria-hidden", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom className", () => {
    const { container } = render(<SkeletonCard className="my-card" />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("my-card");
  });

  it("has inner skeleton elements", () => {
    const { container } = render(<SkeletonCard />);
    const innerSkeletons = container.querySelectorAll(".animate-pulse");
    expect(innerSkeletons.length).toBe(1); // The card itself is animate-pulse
  });
});

describe("SkeletonTable", () => {
  it("renders default 5 rows and 4 columns", () => {
    const { container } = render(<SkeletonTable />);
    // All cells: header (4) + data (5 x 4 = 20) = 24
    const allCells = container.querySelectorAll(".animate-pulse");
    expect(allCells.length).toBe(24);
  });

  it("renders custom rows and columns", () => {
    const { container } = render(<SkeletonTable rows={3} columns={2} />);
    const allCells = container.querySelectorAll(".animate-pulse");
    // 2 header + 3*2 data = 8
    expect(allCells.length).toBe(8);
  });

  it("sets aria-hidden", () => {
    const { container } = render(<SkeletonTable />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom className", () => {
    const { container } = render(<SkeletonTable className="table-skel" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("table-skel");
  });
});

describe("SkeletonMetric", () => {
  it("renders multiple skeleton elements", () => {
    const { container } = render(<SkeletonMetric />);
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("sets aria-hidden", () => {
    const { container } = render(<SkeletonMetric />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom className", () => {
    const { container } = render(<SkeletonMetric className="metric" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("metric");
  });
});

describe("SkeletonBadge", () => {
  it("renders with default width 64", () => {
    const { container } = render(<SkeletonBadge />);
    const badge = container.firstChild as HTMLElement;
    expect(badge).toHaveStyle({ width: "64px" });
  });

  it("renders with custom width", () => {
    const { container } = render(<SkeletonBadge width={100} />);
    const badge = container.firstChild as HTMLElement;
    expect(badge).toHaveStyle({ width: "100px" });
  });

  it("has rounded-full class", () => {
    const { container } = render(<SkeletonBadge />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("rounded-full");
  });

  it("sets aria-hidden", () => {
    const { container } = render(<SkeletonBadge />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom className", () => {
    const { container } = render(<SkeletonBadge className="badge-skel" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain("badge-skel");
  });
});

describe("SkeletonStats", () => {
  it("renders default 4 metric skeletons", () => {
    const { container } = render(<SkeletonStats />);
    // Each SkeletonMetric has aria-hidden on its root
    const metrics = container.querySelectorAll('[aria-hidden="true"]');
    // The outer grid + 4 inner SkeletonMetric = 5 aria-hidden elements
    expect(metrics.length).toBe(5);
  });

  it("renders custom count", () => {
    const { container } = render(<SkeletonStats count={2} />);
    const metrics = container.querySelectorAll('[aria-hidden="true"]');
    // 1 grid wrapper + 2 metric skeletons
    expect(metrics.length).toBe(3);
  });

  it("sets aria-hidden on wrapper", () => {
    const { container } = render(<SkeletonStats />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom className", () => {
    const { container } = render(<SkeletonStats className="stats-grid" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("stats-grid");
  });
});

describe("SkeletonLine", () => {
  it("renders with default width and height", () => {
    const { container } = render(<SkeletonLine />);
    const line = container.firstChild as HTMLElement;
    expect(line).toHaveStyle({ width: "100%", height: "1rem" });
  });

  it("renders with custom width and height", () => {
    const { container } = render(<SkeletonLine width="50%" height="2rem" />);
    const line = container.firstChild as HTMLElement;
    expect(line).toHaveStyle({ width: "50%", height: "2rem" });
  });

  it("sets aria-hidden", () => {
    const { container } = render(<SkeletonLine />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies custom className", () => {
    const { container } = render(<SkeletonLine className="my-line" />);
    const line = container.firstChild as HTMLElement;
    expect(line.className).toContain("my-line");
  });

  it("has animate-pulse class", () => {
    const { container } = render(<SkeletonLine />);
    const line = container.firstChild as HTMLElement;
    expect(line.className).toContain("animate-pulse");
  });
});
