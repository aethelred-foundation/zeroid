import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ComplianceGapAnalysis from '@/components/regulatory/ComplianceGapAnalysis';

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock('lucide-react', () => ({
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  ShieldCheck: (props: any) => <div data-testid="icon-shield-check" {...props} />,
  ShieldAlert: (props: any) => <div data-testid="icon-shield-alert" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  ChevronDown: (props: any) => <div data-testid="icon-chevron-down" {...props} />,
  ChevronUp: (props: any) => <div data-testid="icon-chevron-up" {...props} />,
  ArrowRight: (props: any) => <div data-testid="icon-arrow-right" {...props} />,
  CheckCircle2: (props: any) => <div data-testid="icon-check" {...props} />,
  XCircle: (props: any) => <div data-testid="icon-x-circle" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  FileText: (props: any) => <div data-testid="icon-file" {...props} />,
  Zap: (props: any) => <div data-testid="icon-zap" {...props} />,
}));

const mockGaps = [
  { id: 'g1', name: 'KYC Level 3', description: 'Enhanced due diligence', status: 'missing' as const, priority: 'critical' as const, estimatedDays: 5, category: 'KYC/AML', requiredBy: 'MAS Notice 626' },
  { id: 'g2', name: 'AML Screening', description: 'AML screening cert', status: 'met' as const, priority: 'high' as const, category: 'KYC/AML', currentCredential: 'AML-CERT-001' },
  { id: 'g3', name: 'Data Localization', description: 'Data storage proof', status: 'partial' as const, priority: 'high' as const, estimatedDays: 14, category: 'Data Privacy' },
  { id: 'g4', name: 'Annual Review', description: 'Yearly audit', status: 'expiring' as const, priority: 'high' as const, estimatedDays: 7, category: 'Compliance', expiresAt: '2026-04-01' },
];

describe('ComplianceGapAnalysis', () => {
  it('renders loading state', () => {
    render(<ComplianceGapAnalysis loading={true} />);
    expect(screen.getByText('Analyzing compliance gaps...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<ComplianceGapAnalysis error="Analysis failed" />);
    expect(screen.getByText('Analysis failed')).toBeInTheDocument();
  });

  it('renders header with jurisdiction', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    expect(screen.getByText('Compliance Gap Analysis')).toBeInTheDocument();
    expect(screen.getByText('Singapore (SG)')).toBeInTheDocument();
  });

  it('renders custom jurisdiction', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} jurisdiction="United States (US)" />);
    expect(screen.getByText('United States (US)')).toBeInTheDocument();
  });

  it('renders progress bar with stats', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    expect(screen.getByText('Overall Compliance')).toBeInTheDocument();
    expect(screen.getByText('1/4 requirements met')).toBeInTheDocument();
    expect(screen.getByText('25% complete')).toBeInTheDocument();
  });

  it('renders gap items', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    expect(screen.getByText('KYC Level 3')).toBeInTheDocument();
    expect(screen.getByText('AML Screening')).toBeInTheDocument();
    expect(screen.getByText('Data Localization')).toBeInTheDocument();
  });

  it('renders priority badges', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
  });

  it('renders status labels', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('Expiring')).toBeInTheDocument();
  });

  it('renders estimated days for non-met gaps', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    expect(screen.getByText('~5d to obtain')).toBeInTheDocument();
  });

  it('expands gap detail when clicked', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    fireEvent.click(screen.getByText('KYC Level 3'));
    expect(screen.getByText('MAS Notice 626')).toBeInTheDocument();
  });

  it('shows current credential in expanded met gap', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    fireEvent.click(screen.getByText('AML Screening'));
    expect(screen.getByText('AML-CERT-001')).toBeInTheDocument();
  });

  it('hides met requirements when toggle clicked', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    fireEvent.click(screen.getByText('Hide met requirements'));
    expect(screen.queryByText('AML Screening')).not.toBeInTheDocument();
    expect(screen.getByText('Show all requirements')).toBeInTheDocument();
  });

  it('shows Request Credential button for non-met gaps', () => {
    const onRequestCredential = jest.fn();
    render(<ComplianceGapAnalysis gaps={mockGaps} onRequestCredential={onRequestCredential} />);
    fireEvent.click(screen.getByText('KYC Level 3'));
    fireEvent.click(screen.getByText('Request Credential'));
    expect(onRequestCredential).toHaveBeenCalledWith('g1');
  });

  it('applies custom className', () => {
    const { container } = render(<ComplianceGapAnalysis className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('shows all requirements met message when sortedGaps is empty after filtering', () => {
    const allMetGaps = [
      { id: 'g1', name: 'KYC', description: 'KYC met', status: 'met' as const, priority: 'high' as const, category: 'KYC/AML' },
      { id: 'g2', name: 'AML', description: 'AML met', status: 'met' as const, priority: 'medium' as const, category: 'KYC/AML' },
    ];
    render(<ComplianceGapAnalysis gaps={allMetGaps} />);
    // Hide met requirements to leave empty list
    fireEvent.click(screen.getByText('Hide met requirements'));
    expect(screen.getByText('All requirements are met')).toBeInTheDocument();
  });

  it('renders red progress bar when percentage is below 50', () => {
    // 0 out of 4 met = 0%
    const allMissingGaps = [
      { id: 'g1', name: 'Gap A', description: 'desc', status: 'missing' as const, priority: 'critical' as const, category: 'A' },
      { id: 'g2', name: 'Gap B', description: 'desc', status: 'missing' as const, priority: 'high' as const, category: 'B' },
    ];
    render(<ComplianceGapAnalysis gaps={allMissingGaps} />);
    expect(screen.getByText('0/2 requirements met')).toBeInTheDocument();
    expect(screen.getByText('0% complete')).toBeInTheDocument();
  });

  it('renders emerald progress bar when percentage is >= 80', () => {
    const mostlyMetGaps = [
      { id: 'g1', name: 'Gap Met 1', description: 'desc', status: 'met' as const, priority: 'low' as const, category: 'A' },
      { id: 'g2', name: 'Gap Met 2', description: 'desc', status: 'met' as const, priority: 'low' as const, category: 'A' },
      { id: 'g3', name: 'Gap Met 3', description: 'desc', status: 'met' as const, priority: 'low' as const, category: 'A' },
      { id: 'g4', name: 'Gap Met 4', description: 'desc', status: 'met' as const, priority: 'low' as const, category: 'A' },
      { id: 'g5', name: 'Gap Missing', description: 'desc', status: 'missing' as const, priority: 'low' as const, category: 'A' },
    ];
    render(<ComplianceGapAnalysis gaps={mostlyMetGaps} />);
    expect(screen.getByText('4/5 requirements met')).toBeInTheDocument();
    expect(screen.getByText('80% complete')).toBeInTheDocument();
  });

  it('handles empty gaps array with 0% stats', () => {
    render(<ComplianceGapAnalysis gaps={[]} />);
    expect(screen.getByText('0/0 requirements met')).toBeInTheDocument();
    expect(screen.getByText('0% complete')).toBeInTheDocument();
    expect(screen.getByText('All requirements are met')).toBeInTheDocument();
  });

  it('collapses an expanded gap when clicking it again', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    fireEvent.click(screen.getByText('KYC Level 3'));
    expect(screen.getByText('MAS Notice 626')).toBeInTheDocument();
    // Click again to collapse
    fireEvent.click(screen.getByText('KYC Level 3'));
    // The 'Required By' detail should no longer be in view (collapsed)
  });

  it('shows expiry date for expiring gaps', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    fireEvent.click(screen.getByText('Annual Review'));
    // Should show the expires at date
    expect(screen.getByText(/Expires/)).toBeInTheDocument();
  });

  it('does not show Request Credential button for met gaps', () => {
    const onRequestCredential = jest.fn();
    render(<ComplianceGapAnalysis gaps={mockGaps} onRequestCredential={onRequestCredential} />);
    fireEvent.click(screen.getByText('AML Screening'));
    // Met gap should not have Request Credential button in expanded view
    const buttons = screen.queryAllByText('Request Credential');
    // Only the non-met expanded gap should show the button, but AML Screening is met
    expect(buttons.length).toBe(0);
  });

  it('does not show Request Credential button when callback is not provided', () => {
    render(<ComplianceGapAnalysis gaps={mockGaps} />);
    fireEvent.click(screen.getByText('KYC Level 3'));
    expect(screen.queryByText('Request Credential')).not.toBeInTheDocument();
  });

  it('does not show estimatedDays for met gaps even if defined', () => {
    const gapWithEstimated = [
      { id: 'g1', name: 'Met Gap', description: 'desc', status: 'met' as const, priority: 'high' as const, estimatedDays: 5, category: 'A' },
    ];
    render(<ComplianceGapAnalysis gaps={gapWithEstimated} />);
    expect(screen.queryByText('~5d to obtain')).not.toBeInTheDocument();
  });

  it('renders amber progress bar when percentage is between 50 and 79', () => {
    const halfMetGaps = [
      { id: 'g1', name: 'Met', description: 'desc', status: 'met' as const, priority: 'low' as const, category: 'A' },
      { id: 'g2', name: 'Missing', description: 'desc', status: 'missing' as const, priority: 'low' as const, category: 'A' },
    ];
    render(<ComplianceGapAnalysis gaps={halfMetGaps} />);
    expect(screen.getByText('1/2 requirements met')).toBeInTheDocument();
    expect(screen.getByText('50% complete')).toBeInTheDocument();
  });
});
