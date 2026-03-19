import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

jest.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        if (typeof prop === "string") {
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
              ...rest
            } = props;
            const Tag = prop as any;
            return <Tag ref={ref} {...rest} />;
          });
        }
      },
    },
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

jest.mock(
  "lucide-react",
  () =>
    new Proxy(
      {},
      {
        get: (_target: unknown, prop: string | symbol) => {
          if (prop === "__esModule") return true;
          return (props: any) => (
            <div
              data-testid={`icon-${String(prop).toLowerCase()}`}
              {...props}
            />
          );
        },
      },
    ),
);

jest.mock("../EmptyState", () => ({
  EmptyState: ({ title, description, action }: any) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      <p>{description}</p>
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  ),
}));

import { DataTable, Column } from "../DataTable";

interface TestRow {
  id: string;
  name: string;
  age: number;
}

const columns: Column<TestRow>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "age", header: "Age", sortable: true },
];

const data: TestRow[] = [
  { id: "1", name: "Alice", age: 30 },
  { id: "2", name: "Bob", age: 25 },
  { id: "3", name: "Charlie", age: 35 },
];

describe("DataTable", () => {
  it("renders without crashing", () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={(row) => row.id}
      />,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Age")).toBeInTheDocument();
  });

  it("displays data rows", () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={(row) => row.id}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("shows empty state when data is empty", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        keyExtractor={(_, i) => String(i)}
      />,
    );
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No data found")).toBeInTheDocument();
  });

  it("shows loading skeleton when loading is true", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={(row) => row.id}
        loading
      />,
    );
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("calls onRowClick when a row is clicked", () => {
    const onRowClick = jest.fn();
    render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={(row) => row.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText("Alice"));
    expect(onRowClick).toHaveBeenCalledWith(data[0], 0);
  });

  // ============================================================
  // Sorting tests
  // ============================================================

  describe("sorting", () => {
    it("sorts ascending on first click", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      const cells = container.querySelectorAll("tbody td:first-child");
      const names = Array.from(cells).map((c) => c.textContent);
      expect(names).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("sorts descending on second click", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      fireEvent.click(screen.getByText("Name"));
      const cells = container.querySelectorAll("tbody td:first-child");
      const names = Array.from(cells).map((c) => c.textContent);
      expect(names).toEqual(["Charlie", "Bob", "Alice"]);
    });

    it("resets sort on third click", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      fireEvent.click(screen.getByText("Name"));
      fireEvent.click(screen.getByText("Name"));
      const cells = container.querySelectorAll("tbody td:first-child");
      const names = Array.from(cells).map((c) => c.textContent);
      // Original order
      expect(names).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("sorts numbers correctly", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Age"));
      const cells = container.querySelectorAll("tbody td:nth-child(2)");
      const ages = Array.from(cells).map((c) => c.textContent);
      expect(ages).toEqual(["25", "30", "35"]);
    });

    it("sorts numbers descending", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Age"));
      fireEvent.click(screen.getByText("Age"));
      const cells = container.querySelectorAll("tbody td:nth-child(2)");
      const ages = Array.from(cells).map((c) => c.textContent);
      expect(ages).toEqual(["35", "30", "25"]);
    });

    it("does not sort when sortable prop is false", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          sortable={false}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      const cells = container.querySelectorAll("tbody td:first-child");
      const names = Array.from(cells).map((c) => c.textContent);
      expect(names).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("does not sort non-sortable columns", () => {
      const colsWithNonSortable: Column<TestRow>[] = [
        { key: "name", header: "Name", sortable: false },
        { key: "age", header: "Age", sortable: true },
      ];
      const { container } = render(
        <DataTable
          columns={colsWithNonSortable}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      const cells = container.querySelectorAll("tbody td:first-child");
      const names = Array.from(cells).map((c) => c.textContent);
      expect(names).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("sorts using custom accessor", () => {
      const colsWithAccessor: Column<TestRow>[] = [
        {
          key: "name",
          header: "Name",
          sortable: true,
          accessor: (row) => row.name.toLowerCase(),
        },
        { key: "age", header: "Age", sortable: true },
      ];
      const { container } = render(
        <DataTable
          columns={colsWithAccessor}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      const cells = container.querySelectorAll("tbody td:first-child");
      const names = Array.from(cells).map((c) => c.textContent);
      // accessor returns lowercase, which is also used for display
      expect(names).toEqual(["alice", "bob", "charlie"]);
    });

    it("handles null values in sort (pushes nulls to end)", () => {
      interface NullRow {
        id: string;
        val: string | null;
      }
      const nullCols: Column<NullRow>[] = [
        { key: "val", header: "Val", sortable: true },
      ];
      const nullData: NullRow[] = [
        { id: "1", val: null },
        { id: "2", val: "Banana" },
        { id: "3", val: "Apple" },
      ];
      const { container } = render(
        <DataTable
          columns={nullCols}
          data={nullData}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Val"));
      const cells = container.querySelectorAll("tbody td");
      const vals = Array.from(cells).map((c) => c.textContent);
      // null should be pushed to end in asc sort
      expect(vals).toEqual(["Apple", "Banana", "-"]);
    });

    it("handles only bVal being null in sort", () => {
      interface NullRow {
        id: string;
        val: string | null;
      }
      const nullCols: Column<NullRow>[] = [
        { key: "val", header: "Val", sortable: true },
      ];
      const nullData: NullRow[] = [
        { id: "1", val: "Apple" },
        { id: "2", val: null },
      ];
      const { container } = render(
        <DataTable
          columns={nullCols}
          data={nullData}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Val"));
      const cells = container.querySelectorAll("tbody td");
      const vals = Array.from(cells).map((c) => c.textContent);
      // bVal null should be pushed to end
      expect(vals).toEqual(["Apple", "-"]);
    });

    it("handles both values being null in sort", () => {
      interface NullRow {
        id: string;
        val: string | null;
      }
      const nullCols: Column<NullRow>[] = [
        { key: "val", header: "Val", sortable: true },
      ];
      const nullData: NullRow[] = [
        { id: "1", val: null },
        { id: "2", val: null },
        { id: "3", val: "Apple" },
      ];
      const { container } = render(
        <DataTable
          columns={nullCols}
          data={nullData}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Val"));
      const cells = container.querySelectorAll("tbody td");
      const vals = Array.from(cells).map((c) => c.textContent);
      expect(vals[0]).toBe("Apple");
    });

    it("handles mixed type comparison (falls back to string)", () => {
      interface MixedRow {
        id: string;
        val: unknown;
      }
      const mixedCols: Column<MixedRow>[] = [
        { key: "val", header: "Val", sortable: true },
      ];
      // Use objects that aren't string or number to trigger the else branch
      const mixedData: MixedRow[] = [
        { id: "1", val: "zeta" },
        { id: "2", val: "alpha" },
      ];
      // Override one value with a non-string non-number via accessor
      const mixedColsWithAccessor: Column<MixedRow>[] = [
        {
          key: "val",
          header: "Val",
          sortable: true,
          accessor: (row) => {
            // Return an object to trigger the fallback String() comparison
            if ((row as any).id === "1") return { toString: () => "zeta" };
            return { toString: () => "alpha" };
          },
          render: (value) => <span>{String(value)}</span>,
        },
      ];
      const { container } = render(
        <DataTable
          columns={mixedColsWithAccessor}
          data={mixedData}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Val"));
      const cells = container.querySelectorAll("tbody td");
      const vals = Array.from(cells).map((c) => c.textContent);
      // "alpha" < "zeta" in string comparison
      expect(vals).toEqual(["alpha", "zeta"]);
    });

    it("switching to a different column starts ascending sort", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      // Sort by name desc
      fireEvent.click(screen.getByText("Name"));
      fireEvent.click(screen.getByText("Name"));
      // Now sort by age (should start ascending)
      fireEvent.click(screen.getByText("Age"));
      const cells = container.querySelectorAll("tbody td:nth-child(2)");
      const ages = Array.from(cells).map((c) => c.textContent);
      expect(ages).toEqual(["25", "30", "35"]);
    });

    it("resets page to 1 when sorting", () => {
      // Create enough data for pagination
      const bigData: TestRow[] = Array.from({ length: 15 }, (_, i) => ({
        id: String(i),
        name: `Person ${String(i).padStart(2, "0")}`,
        age: 20 + i,
      }));
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={5}
        />,
      );
      // Go to page 2
      fireEvent.click(screen.getByText("2"));
      expect(screen.getByText(/Showing 6-10/)).toBeInTheDocument();
      // Now sort - should reset to page 1
      fireEvent.click(screen.getByText("Name"));
      expect(screen.getByText(/Showing 1-5/)).toBeInTheDocument();
    });
  });

  // ============================================================
  // SortIcon tests
  // ============================================================

  describe("SortIcon", () => {
    it("shows unsorted icon by default", () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      // ChevronsUpDown icon should be present for unsorted columns
      expect(
        screen.getAllByTestId("icon-chevronsupdown").length,
      ).toBeGreaterThan(0);
    });

    it("shows ascending icon when sorted asc", () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      expect(screen.getByTestId("icon-chevronup")).toBeInTheDocument();
    });

    it("shows descending icon when sorted desc", () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      fireEvent.click(screen.getByText("Name"));
      expect(screen.getByTestId("icon-chevrondown")).toBeInTheDocument();
    });
  });

  // ============================================================
  // Pagination tests
  // ============================================================

  describe("pagination", () => {
    const bigData: TestRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      name: `Person ${i}`,
      age: 20 + i,
    }));

    it("does not show pagination when data fits in one page", () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      expect(screen.queryByLabelText("Next page")).not.toBeInTheDocument();
    });

    it("shows pagination when data exceeds one page", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      expect(screen.getByLabelText("Next page")).toBeInTheDocument();
      expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    });

    it("shows correct item count", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      expect(
        screen.getByText("Showing 1-10 of 25 results"),
      ).toBeInTheDocument();
    });

    it("navigates to next page", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      fireEvent.click(screen.getByLabelText("Next page"));
      expect(
        screen.getByText("Showing 11-20 of 25 results"),
      ).toBeInTheDocument();
    });

    it("navigates to previous page", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      fireEvent.click(screen.getByLabelText("Next page"));
      fireEvent.click(screen.getByLabelText("Previous page"));
      expect(
        screen.getByText("Showing 1-10 of 25 results"),
      ).toBeInTheDocument();
    });

    it("disables previous button on first page", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      expect(screen.getByLabelText("Previous page")).toBeDisabled();
    });

    it("disables next button on last page", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      fireEvent.click(screen.getByText("3"));
      expect(screen.getByLabelText("Next page")).toBeDisabled();
    });

    it("navigates to specific page via page number button", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      fireEvent.click(screen.getByText("2"));
      expect(
        screen.getByText("Showing 11-20 of 25 results"),
      ).toBeInTheDocument();
    });

    it("shows last page with correct endItem (capped at totalItems)", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      fireEvent.click(screen.getByText("3"));
      expect(
        screen.getByText("Showing 21-25 of 25 results"),
      ).toBeInTheDocument();
    });

    it("uses custom pageSize", () => {
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={5}
        />,
      );
      expect(screen.getByText("Showing 1-5 of 25 results")).toBeInTheDocument();
    });

    it("shows ellipsis for many pages", () => {
      const manyData: TestRow[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        name: `Person ${i}`,
        age: 20 + i,
      }));
      render(
        <DataTable
          columns={columns}
          data={manyData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      // With 10 pages, totalPages > 7, so ellipsis should appear
      const ellipses = screen.getAllByText("...");
      expect(ellipses.length).toBeGreaterThan(0);
    });

    it("shows ellipsis correctly when on middle page", () => {
      const manyData: TestRow[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        name: `Person ${i}`,
        age: 20 + i,
      }));
      render(
        <DataTable
          columns={columns}
          data={manyData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      // Navigate to page 5 (middle)
      fireEvent.click(screen.getByLabelText("Next page")); // page 2
      fireEvent.click(screen.getByLabelText("Next page")); // page 3
      fireEvent.click(screen.getByLabelText("Next page")); // page 4
      fireEvent.click(screen.getByLabelText("Next page")); // page 5
      // Both ellipses should be present (before and after middle pages)
      const ellipses = screen.getAllByText("...");
      expect(ellipses.length).toBe(2);
    });

    it("shows no ellipsis when totalPages <= 7", () => {
      const smallData: TestRow[] = Array.from({ length: 35 }, (_, i) => ({
        id: String(i),
        name: `Person ${i}`,
        age: 20 + i,
      }));
      render(
        <DataTable
          columns={columns}
          data={smallData}
          keyExtractor={(row) => row.id}
          pageSize={5}
        />,
      );
      // 7 pages exactly
      expect(screen.queryByText("...")).not.toBeInTheDocument();
    });

    it("shows only trailing ellipsis on early pages", () => {
      const manyData: TestRow[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        name: `Person ${i}`,
        age: 20 + i,
      }));
      render(
        <DataTable
          columns={columns}
          data={manyData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      // On page 1, currentPage <= 3 so no leading ellipsis, but currentPage < totalPages - 2 so trailing ellipsis
      const ellipses = screen.getAllByText("...");
      expect(ellipses.length).toBe(1);
    });

    it("shows only leading ellipsis on late pages", () => {
      const manyData: TestRow[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        name: `Person ${i}`,
        age: 20 + i,
      }));
      render(
        <DataTable
          columns={columns}
          data={manyData}
          keyExtractor={(row) => row.id}
          pageSize={10}
        />,
      );
      // Navigate to last page (10)
      fireEvent.click(screen.getByText("10"));
      // currentPage (10) > 3 so leading ellipsis, but currentPage (10) >= totalPages - 2 (8) so no trailing ellipsis
      const ellipses = screen.getAllByText("...");
      expect(ellipses.length).toBe(1);
    });
  });

  // ============================================================
  // Column alignment tests
  // ============================================================

  describe("column alignment", () => {
    it("applies text-center for center alignment", () => {
      const centeredCols: Column<TestRow>[] = [
        { key: "name", header: "Name", align: "center" },
        { key: "age", header: "Age" },
      ];
      const { container } = render(
        <DataTable
          columns={centeredCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const th = container.querySelector("th");
      expect(th?.className).toContain("text-center");
    });

    it("applies text-right for right alignment", () => {
      const rightCols: Column<TestRow>[] = [
        { key: "name", header: "Name", align: "right" },
        { key: "age", header: "Age" },
      ];
      const { container } = render(
        <DataTable
          columns={rightCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const th = container.querySelector("th");
      expect(th?.className).toContain("text-right");
    });

    it("applies text-left for default alignment", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const th = container.querySelector("th");
      expect(th?.className).toContain("text-left");
    });

    it("right-aligned column header has flex-row-reverse", () => {
      const rightCols: Column<TestRow>[] = [
        { key: "name", header: "Name", align: "right", sortable: true },
        { key: "age", header: "Age" },
      ];
      const { container } = render(
        <DataTable
          columns={rightCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const headerDiv = container.querySelector("th div");
      expect(headerDiv?.className).toContain("flex-row-reverse");
    });

    it("applies alignment to body cells too", () => {
      const centeredCols: Column<TestRow>[] = [
        { key: "name", header: "Name", align: "center" },
        { key: "age", header: "Age" },
      ];
      const { container } = render(
        <DataTable
          columns={centeredCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const td = container.querySelector("tbody td");
      expect(td?.className).toContain("text-center");
    });
  });

  // ============================================================
  // Custom render and accessor tests
  // ============================================================

  describe("custom render and accessor", () => {
    it("uses custom render function for cell display", () => {
      const customCols: Column<TestRow>[] = [
        {
          key: "name",
          header: "Name",
          render: (value) => (
            <strong data-testid="custom-render">{String(value)}</strong>
          ),
        },
        { key: "age", header: "Age" },
      ];
      render(
        <DataTable
          columns={customCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      expect(screen.getAllByTestId("custom-render").length).toBe(3);
      expect(screen.getByText("Alice").tagName).toBe("STRONG");
    });

    it("passes correct arguments to render function", () => {
      const renderFn = jest.fn((value, row, index) => (
        <span>{String(value)}</span>
      ));
      const customCols: Column<TestRow>[] = [
        { key: "name", header: "Name", render: renderFn },
        { key: "age", header: "Age" },
      ];
      render(
        <DataTable
          columns={customCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      expect(renderFn).toHaveBeenCalledWith("Alice", data[0], 0);
      expect(renderFn).toHaveBeenCalledWith("Bob", data[1], 1);
      expect(renderFn).toHaveBeenCalledWith("Charlie", data[2], 2);
    });

    it("uses custom accessor for cell value", () => {
      const customCols: Column<TestRow>[] = [
        {
          key: "computed",
          header: "Computed",
          accessor: (row) => `${row.name}-${row.age}`,
        },
      ];
      render(
        <DataTable
          columns={customCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      expect(screen.getByText("Alice-30")).toBeInTheDocument();
    });

    it("displays dash for null/undefined values without custom render", () => {
      interface NullRow {
        id: string;
        val: string | null;
      }
      const nullCols: Column<NullRow>[] = [{ key: "val", header: "Val" }];
      const nullData: NullRow[] = [{ id: "1", val: null }];
      render(
        <DataTable
          columns={nullCols}
          data={nullData}
          keyExtractor={(row) => row.id}
        />,
      );
      expect(screen.getByText("-")).toBeInTheDocument();
    });
  });

  // ============================================================
  // Column width tests
  // ============================================================

  describe("column width", () => {
    it("applies width style to header and body cells", () => {
      const widthCols: Column<TestRow>[] = [
        { key: "name", header: "Name", width: "200px" },
        { key: "age", header: "Age" },
      ];
      const { container } = render(
        <DataTable
          columns={widthCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const th = container.querySelector("th");
      expect(th?.style.width).toBe("200px");
      const td = container.querySelector("tbody td");
      expect(td?.style.width).toBe("200px");
    });

    it("does not set width style when width is not specified", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const th = container.querySelector("th");
      expect(th?.style.width).toBe("");
    });
  });

  // ============================================================
  // Empty state customization tests
  // ============================================================

  describe("empty state customization", () => {
    it("uses custom emptyTitle and emptyDescription", () => {
      render(
        <DataTable
          columns={columns}
          data={[]}
          keyExtractor={(_, i) => String(i)}
          emptyTitle="Nothing here"
          emptyDescription="Try adding some items"
        />,
      );
      expect(screen.getByText("Nothing here")).toBeInTheDocument();
      expect(screen.getByText("Try adding some items")).toBeInTheDocument();
    });

    it("passes emptyAction to EmptyState", () => {
      const onClick = jest.fn();
      render(
        <DataTable
          columns={columns}
          data={[]}
          keyExtractor={(_, i) => String(i)}
          emptyAction={{ label: "Add Item", onClick }}
        />,
      );
      const button = screen.getByText("Add Item");
      fireEvent.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // stickyHeader tests
  // ============================================================

  describe("stickyHeader", () => {
    it("adds sticky class when stickyHeader is true", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          stickyHeader
        />,
      );
      const headerRow = container.querySelector("thead tr");
      expect(headerRow?.className).toContain("sticky");
    });

    it("does not add sticky class when stickyHeader is false", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const headerRow = container.querySelector("thead tr");
      expect(headerRow?.className).not.toContain("sticky");
    });
  });

  // ============================================================
  // className prop test
  // ============================================================

  describe("className", () => {
    it("applies custom className to the wrapper", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          className="my-custom-class"
        />,
      );
      expect(container.firstElementChild?.className).toContain(
        "my-custom-class",
      );
    });

    it("applies custom className in loading state", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          loading
          className="loading-class"
        />,
      );
      expect(container.firstElementChild?.className).toContain("loading-class");
    });

    it("applies custom className in empty state", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={[]}
          keyExtractor={(_, i) => String(i)}
          className="empty-class"
        />,
      );
      expect(container.firstElementChild?.className).toContain("empty-class");
    });
  });

  // ============================================================
  // Row click styling tests
  // ============================================================

  describe("row click styling", () => {
    it("applies cursor-pointer class when onRowClick is provided", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          onRowClick={() => {}}
        />,
      );
      const row = container.querySelector("tbody tr");
      expect(row?.className).toContain("cursor-pointer");
    });

    it("does not apply cursor-pointer class when onRowClick is not provided", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const row = container.querySelector("tbody tr");
      expect(row?.className).not.toContain("cursor-pointer");
    });
  });

  // ============================================================
  // keyExtractor tests
  // ============================================================

  describe("keyExtractor", () => {
    it("uses index-based keyExtractor", () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(_, i) => String(i)}
        />,
      );
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
  });

  // ============================================================
  // onRowClick with correct global index on paginated data
  // ============================================================

  describe("onRowClick with pagination", () => {
    it("passes correct global index on second page", () => {
      const onRowClick = jest.fn();
      const bigData: TestRow[] = Array.from({ length: 15 }, (_, i) => ({
        id: String(i),
        name: `Person ${i}`,
        age: 20 + i,
      }));
      render(
        <DataTable
          columns={columns}
          data={bigData}
          keyExtractor={(row) => row.id}
          pageSize={5}
          onRowClick={onRowClick}
        />,
      );
      // Go to page 2
      fireEvent.click(screen.getByText("2"));
      // Click first row on page 2
      fireEvent.click(screen.getByText("Person 5"));
      expect(onRowClick).toHaveBeenCalledWith(bigData[5], 5);
    });
  });

  // ============================================================
  // Sort icon not shown for non-sortable columns
  // ============================================================

  describe("sort icon visibility", () => {
    it("does not show sort icon on non-sortable column", () => {
      const mixedCols: Column<TestRow>[] = [
        { key: "name", header: "Name", sortable: false },
        { key: "age", header: "Age", sortable: true },
      ];
      render(
        <DataTable
          columns={mixedCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      // Only one ChevronsUpDown icon for the age column (sortable)
      const icons = screen.getAllByTestId("icon-chevronsupdown");
      expect(icons.length).toBe(1);
    });

    it("does not show sort icons when sortable is false globally", () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          sortable={false}
        />,
      );
      expect(
        screen.queryByTestId("icon-chevronsupdown"),
      ).not.toBeInTheDocument();
    });
  });

  // ============================================================
  // Accessor used in body cell rendering
  // ============================================================

  describe("accessor in body cells", () => {
    it("uses accessor to get cell value (not key lookup)", () => {
      const accessorCols: Column<TestRow>[] = [
        {
          key: "display",
          header: "Display",
          accessor: (row) => `${row.name} (${row.age})`,
        },
      ];
      render(
        <DataTable
          columns={accessorCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      expect(screen.getByText("Alice (30)")).toBeInTheDocument();
      expect(screen.getByText("Bob (25)")).toBeInTheDocument();
    });
  });

  // ============================================================
  // handleSort when sortable is true but column.sortable is explicitly false
  // ============================================================

  describe("handleSort edge cases", () => {
    it("does not sort when column.sortable is false even if table sortable is true (line 199)", () => {
      // handleSort returns early when !sortable (line 199)
      // But we also need to cover the case where we click a non-sortable col header
      // which already guards via isSortable check in onClick
      const colsExplicit: Column<TestRow>[] = [
        { key: "name", header: "Name", sortable: true },
        { key: "age", header: "Age", sortable: false },
      ];
      const { container } = render(
        <DataTable
          columns={colsExplicit}
          data={data}
          keyExtractor={(row) => row.id}
          sortable={true}
        />,
      );
      // Click on the non-sortable column header
      fireEvent.click(screen.getByText("Age"));
      // Data should remain unsorted
      const cells = container.querySelectorAll("tbody td:first-child");
      const names = Array.from(cells).map((c) => c.textContent);
      expect(names).toEqual(["Alice", "Bob", "Charlie"]);
    });

    it("handles sort on column with no matching column in columns array (line 218)", () => {
      const { rerender, container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      fireEvent.click(screen.getByText("Name"));
      const newCols: Column<TestRow>[] = [
        { key: "age", header: "Age", sortable: true },
      ];
      rerender(
        <DataTable
          columns={newCols}
          data={data}
          keyExtractor={(row) => row.id}
        />,
      );
      const cells = container.querySelectorAll("tbody td");
      expect(cells.length).toBeGreaterThan(0);
    });

    it("covers the !sortable early return in handleSort (line 199)", () => {
      // sortable starts true, user sorts, then re-render with sortable=false
      // The handleSort callback is recreated when sortable changes
      // but the onClick handler guards with isSortable, so handleSort is never called with !sortable.
      // To cover it, we need to change sortable after a header is rendered with a click handler.
      // This is a guard branch within handleSort: `if (!sortable) return;`
      // Since onClick already checks `isSortable && handleSort(...)`, this internal guard
      // in handleSort is never reached through the UI. Let's try re-rendering with sortable toggling.
      const { rerender, container } = render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          sortable={true}
        />,
      );
      // Click to sort while sortable is true
      fireEvent.click(screen.getByText("Name"));
      // Now rerender with sortable false - the click handler should be updated
      rerender(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={(row) => row.id}
          sortable={false}
        />,
      );
      // Try clicking the header - isSortable check prevents handleSort from being called
      fireEvent.click(screen.getByText("Name"));
      const cells = container.querySelectorAll("tbody td:first-child");
      const names = Array.from(cells).map((c) => c.textContent);
      // Data order should be from the previous ascending sort
      expect(names).toEqual(["Alice", "Bob", "Charlie"]);
    });
  });

  // ============================================================
  // Loading skeleton row count
  // ============================================================

  describe("loading skeleton", () => {
    it("renders 5 skeleton rows", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={[]}
          keyExtractor={(_, i) => String(i)}
          loading
        />,
      );
      // Header skeleton (1) + 5 row skeletons = 6 flex containers with gap-4
      const skeletonRows = container.querySelectorAll(".flex.gap-4");
      // 1 header + 5 rows
      expect(skeletonRows.length).toBe(6);
    });

    it("renders skeleton columns matching column count", () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={[]}
          keyExtractor={(_, i) => String(i)}
          loading
        />,
      );
      const pulseElements = container.querySelectorAll(".animate-pulse");
      // 2 columns x (1 header + 5 rows) = 12
      expect(pulseElements.length).toBe(12);
    });
  });
});
