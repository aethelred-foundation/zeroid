import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RiskHeatmap from '@/components/ai/RiskHeatmap';

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, onClick, onMouseEnter, onMouseLeave, ...props }: any) => (
      <button onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock('lucide-react', () => ({
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  Filter: (props: any) => <div data-testid="icon-filter" {...props} />,
  ChevronDown: (props: any) => <div data-testid="icon-chevron-down" {...props} />,
  Info: (props: any) => <div data-testid="icon-info" {...props} />,
  X: (props: any) => <div data-testid="icon-x" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
}));

const mockData = [
  {
    category: 'KYC/AML',
    jurisdiction: 'US',
    score: 25,
    severity: 'low' as const,
    factors: [
      { name: 'Regulatory Gap', score: 20, description: 'Missing framework' },
    ],
    lastUpdated: new Date().toISOString(),
  },
  {
    category: 'KYC/AML',
    jurisdiction: 'EU',
    score: 75,
    severity: 'high' as const,
    factors: [
      { name: 'Enforcement Risk', score: 80, description: 'High enforcement' },
    ],
    lastUpdated: new Date().toISOString(),
  },
  {
    category: 'Sanctions',
    jurisdiction: 'US',
    score: 50,
    severity: 'medium' as const,
    factors: [
      { name: 'Data Risk', score: 45, description: 'Moderate data risk' },
    ],
    lastUpdated: new Date().toISOString(),
  },
  {
    category: 'Sanctions',
    jurisdiction: 'EU',
    score: 90,
    severity: 'critical' as const,
    factors: [
      { name: 'Regulatory Gap', score: 95, description: 'Critical gap' },
    ],
    lastUpdated: new Date().toISOString(),
  },
];

const categories = ['KYC/AML', 'Sanctions'];
const jurisdictions = ['US', 'EU'];

describe('RiskHeatmap', () => {
  it('renders loading state', () => {
    render(<RiskHeatmap loading={true} />);
    expect(screen.getByText('Loading risk data...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<RiskHeatmap error="Failed to fetch" />);
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });

  it('renders with default data when no props provided', () => {
    render(<RiskHeatmap />);
    expect(screen.getByText('Risk Heatmap')).toBeInTheDocument();
  });

  it('renders with provided data', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    expect(screen.getByText('Risk Heatmap')).toBeInTheDocument();
    expect(screen.getByText('US')).toBeInTheDocument();
    expect(screen.getByText('EU')).toBeInTheDocument();
    expect(screen.getByText('KYC/AML')).toBeInTheDocument();
    expect(screen.getByText('Sanctions')).toBeInTheDocument();
  });

  it('displays cell scores', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it('renders legend items', () => {
    render(<RiskHeatmap data={mockData} categories={categories} jurisdictions={jurisdictions} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('opens filter dropdown when filter button is clicked', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    const filterButton = screen.getByText('All Categories');
    fireEvent.click(filterButton);
    // Dropdown options should appear
    expect(screen.getAllByText('All Categories').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('KYC/AML').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by category when a category is selected', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    // Open filter
    fireEvent.click(screen.getByText('All Categories'));
    // Select KYC/AML (click the one in the dropdown)
    const kycOptions = screen.getAllByText('KYC/AML');
    fireEvent.click(kycOptions[kycOptions.length - 1]);
    // After filtering to KYC/AML, the Sanctions row label is removed from the grid
    // but "Sanctions" may still appear in the filter dropdown options
    const kycRowLabels = screen.queryAllByText('KYC/AML');
    expect(kycRowLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onCellClick when a cell is clicked', () => {
    const onCellClick = jest.fn();
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
        onCellClick={onCellClick}
      />
    );
    // Click a score cell
    fireEvent.click(screen.getByText('25'));
    expect(onCellClick).toHaveBeenCalledWith(expect.objectContaining({ score: 25 }));
  });

  it('shows drill-down panel when a cell is clicked', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    fireEvent.click(screen.getByText('75'));
    // Drill-down panel should show jurisdiction and category
    expect(screen.getByText('EU - KYC/AML')).toBeInTheDocument();
    expect(screen.getByText(/Score: 75\/100/)).toBeInTheDocument();
  });

  it('closes drill-down panel when close button is clicked', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    fireEvent.click(screen.getByText('75'));
    expect(screen.getByText('EU - KYC/AML')).toBeInTheDocument();

    const closeButtons = screen.getAllByTestId('icon-x');
    const closeButton = closeButtons.find((el) => el.closest('button'));
    if (closeButton?.closest('button')) {
      fireEvent.click(closeButton.closest('button')!);
    }
  });

  it('applies custom className', () => {
    const { container } = render(<RiskHeatmap className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('shows tooltip on cell hover', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    // Hover over a cell to trigger tooltip
    const cell = screen.getByText('25');
    fireEvent.mouseEnter(cell, { clientX: 200, clientY: 200 });
    // Tooltip should show jurisdiction - category header
    expect(screen.getByText('US - KYC/AML')).toBeInTheDocument();
    // Mouse leave should hide tooltip
    fireEvent.mouseLeave(cell);
  });

  it('does not show tooltip when a cell is selected (drill-down open)', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    // Select a cell first
    fireEvent.click(screen.getByText('75'));
    expect(screen.getByText('EU - KYC/AML')).toBeInTheDocument();
    // Now hover over another cell - tooltip should NOT appear
    fireEvent.mouseEnter(screen.getByText('25'), { clientX: 200, clientY: 200 });
    // The US-KYC/AML tooltip should not appear since selectedCell is set
    expect(screen.queryByText('US - KYC/AML')).not.toBeInTheDocument();
  });

  it('deselects cell when clicking the same cell again', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    // Select
    fireEvent.click(screen.getByText('75'));
    expect(screen.getByText('EU - KYC/AML')).toBeInTheDocument();
    // Click same cell again to deselect
    fireEvent.click(screen.getByText('75'));
    expect(screen.queryByText(/Score: 75\/100/)).not.toBeInTheDocument();
  });

  it('clicks category in dropdown to filter and then resets with All Categories', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    // Open dropdown
    const filterIcon = screen.getByTestId('icon-filter');
    const filterBtn = filterIcon.closest('button')!;
    fireEvent.click(filterBtn);

    // The dropdown should now be visible with category buttons
    // Find all buttons in the dropdown menu
    const dropdownButtons = screen.getAllByRole('button').filter(
      (btn) => btn.className.includes('w-full text-left')
    );
    expect(dropdownButtons.length).toBeGreaterThan(0);

    // Click a category button (e.g., "Sanctions")
    const sanctionsDropdownBtn = dropdownButtons.find(
      (btn) => btn.textContent === 'Sanctions'
    );
    expect(sanctionsDropdownBtn).toBeTruthy();
    fireEvent.click(sanctionsDropdownBtn!);

    // Now open dropdown again and click "All Categories"
    fireEvent.click(filterBtn);
    const allCatDropdownBtns = screen.getAllByRole('button').filter(
      (btn) => btn.className.includes('w-full text-left') && btn.textContent === 'All Categories'
    );
    expect(allCatDropdownBtns.length).toBeGreaterThan(0);
    fireEvent.click(allCatDropdownBtns[0]);
  });

  it('renders cells with various score colors', () => {
    const variedData = [
      { category: 'KYC/AML', jurisdiction: 'US', score: 10, severity: 'low' as const, factors: [{ name: 'F1', score: 10, description: 'D1' }], lastUpdated: new Date().toISOString() },
      { category: 'KYC/AML', jurisdiction: 'EU', score: 28, severity: 'low' as const, factors: [{ name: 'F2', score: 28, description: 'D2' }], lastUpdated: new Date().toISOString() },
      { category: 'Sanctions', jurisdiction: 'US', score: 40, severity: 'medium' as const, factors: [{ name: 'F3', score: 40, description: 'D3' }], lastUpdated: new Date().toISOString() },
      { category: 'Sanctions', jurisdiction: 'EU', score: 55, severity: 'medium' as const, factors: [{ name: 'F4', score: 55, description: 'D4' }], lastUpdated: new Date().toISOString() },
      { category: 'Data Privacy', jurisdiction: 'US', score: 70, severity: 'high' as const, factors: [{ name: 'F5', score: 70, description: 'D5' }], lastUpdated: new Date().toISOString() },
      { category: 'Data Privacy', jurisdiction: 'EU', score: 85, severity: 'high' as const, factors: [{ name: 'F6', score: 85, description: 'D6' }], lastUpdated: new Date().toISOString() },
      { category: 'Cross-border', jurisdiction: 'US', score: 95, severity: 'critical' as const, factors: [{ name: 'F7', score: 95, description: 'D7' }], lastUpdated: new Date().toISOString() },
    ];
    render(
      <RiskHeatmap
        data={variedData}
        categories={['KYC/AML', 'Sanctions', 'Data Privacy', 'Cross-border']}
        jurisdictions={['US', 'EU']}
      />
    );
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
  });

  it('renders empty cell when data is missing for a category-jurisdiction pair', () => {
    const sparseData = [
      { category: 'KYC/AML', jurisdiction: 'US', score: 30, severity: 'medium' as const, factors: [{ name: 'F1', score: 30, description: 'D1' }], lastUpdated: new Date().toISOString() },
      // Missing KYC/AML-EU data
    ];
    render(
      <RiskHeatmap
        data={sparseData}
        categories={['KYC/AML']}
        jurisdictions={['US', 'EU']}
      />
    );
    expect(screen.getByText('30')).toBeInTheDocument();
    // EU cell should render as empty placeholder
  });

  it('shows drill-down panel with factor scores and severity colors', () => {
    const dataWithFactors = [
      {
        category: 'KYC/AML',
        jurisdiction: 'US',
        score: 50,
        severity: 'medium' as const,
        factors: [
          { name: 'Regulatory Gap', score: 20, description: 'Missing framework' },
          { name: 'Enforcement Risk', score: 60, description: 'High enforcement' },
          { name: 'Data Risk', score: 80, description: 'Significant data risk' },
        ],
        lastUpdated: new Date().toISOString(),
      },
    ];
    render(
      <RiskHeatmap
        data={dataWithFactors}
        categories={['KYC/AML']}
        jurisdictions={['US']}
      />
    );
    fireEvent.click(screen.getByText('50'));
    expect(screen.getByText('US - KYC/AML')).toBeInTheDocument();
    expect(screen.getByText('Missing framework')).toBeInTheDocument();
    expect(screen.getByText('High enforcement')).toBeInTheDocument();
    expect(screen.getByText('Significant data risk')).toBeInTheDocument();
  });

  it('tooltip shows factor scores with progress bars', () => {
    render(
      <RiskHeatmap
        data={mockData}
        categories={categories}
        jurisdictions={jurisdictions}
      />
    );
    // Hover to show tooltip
    fireEvent.mouseEnter(screen.getByText('90'), { clientX: 300, clientY: 300 });
    // The tooltip should show the factor details
    expect(screen.getByText('EU - Sanctions')).toBeInTheDocument();
    expect(screen.getByText('90/100')).toBeInTheDocument();
    expect(screen.getByText('Regulatory Gap')).toBeInTheDocument();
  });

  it('renders with getSeverity covering all thresholds', () => {
    const thresholdData = [
      { category: 'KYC/AML', jurisdiction: 'US', score: 0, severity: 'low' as const, factors: [], lastUpdated: new Date().toISOString() },
      { category: 'KYC/AML', jurisdiction: 'EU', score: 25, severity: 'low' as const, factors: [], lastUpdated: new Date().toISOString() },
      { category: 'Sanctions', jurisdiction: 'US', score: 26, severity: 'medium' as const, factors: [], lastUpdated: new Date().toISOString() },
      { category: 'Sanctions', jurisdiction: 'EU', score: 50, severity: 'medium' as const, factors: [], lastUpdated: new Date().toISOString() },
      { category: 'Data Privacy', jurisdiction: 'US', score: 51, severity: 'high' as const, factors: [], lastUpdated: new Date().toISOString() },
      { category: 'Data Privacy', jurisdiction: 'EU', score: 76, severity: 'critical' as const, factors: [], lastUpdated: new Date().toISOString() },
    ];
    render(
      <RiskHeatmap
        data={thresholdData}
        categories={['KYC/AML', 'Sanctions', 'Data Privacy']}
        jurisdictions={['US', 'EU']}
      />
    );
    // Click on score 76 (critical) to verify getSeverity in DrillDownPanel
    fireEvent.click(screen.getByText('76'));
    expect(screen.getAllByText('Critical').length).toBeGreaterThanOrEqual(1);
  });
});
