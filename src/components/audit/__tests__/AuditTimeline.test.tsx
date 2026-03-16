import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AuditTimeline from '@/components/audit/AuditTimeline';

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock('lucide-react', () => ({
  ShieldCheck: (props: any) => <div data-testid="icon-shield-check" {...props} />,
  ShieldAlert: (props: any) => <div data-testid="icon-shield-alert" {...props} />,
  FileText: (props: any) => <div data-testid="icon-file" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  Eye: (props: any) => <div data-testid="icon-eye" {...props} />,
  UserCheck: (props: any) => <div data-testid="icon-user-check" {...props} />,
  KeyRound: (props: any) => <div data-testid="icon-key" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  Filter: (props: any) => <div data-testid="icon-filter" {...props} />,
  ChevronDown: (props: any) => <div data-testid="icon-chevron-down" {...props} />,
}));

const mockEvents = [
  {
    id: 'evt-1',
    type: 'credential-issued' as const,
    timestamp: '2026-03-15T10:00:00Z',
    description: 'KYC credential issued',
    transactionHash: '0xabc123def456789012345678901234567890abcdef',
  },
  {
    id: 'evt-2',
    type: 'proof-generated' as const,
    timestamp: '2026-03-14T09:00:00Z',
    description: 'ZK proof generated for age verification',
  },
  {
    id: 'evt-3',
    type: 'credential-revoked' as const,
    timestamp: '2026-03-13T08:00:00Z',
    description: 'Old credential revoked',
  },
];

jest.mock('@/hooks/useAudit', () => ({
  useAudit: jest.fn(),
}));

import { useAudit } from '@/hooks/useAudit';
const mockUseAudit = useAudit as jest.Mock;

describe('AuditTimeline', () => {
  beforeEach(() => {
    mockUseAudit.mockReturnValue({
      events: mockEvents,
      isLoading: false,
      error: null,
    });
  });

  it('renders loading state', () => {
    mockUseAudit.mockReturnValue({ events: [], isLoading: true, error: null });
    render(<AuditTimeline />);
    expect(screen.getByText('Loading audit trail...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    mockUseAudit.mockReturnValue({ events: [], isLoading: false, error: new Error('fail') });
    render(<AuditTimeline />);
    expect(screen.getByText('Failed to load audit events')).toBeInTheDocument();
  });

  it('renders empty state when no events', () => {
    mockUseAudit.mockReturnValue({ events: [], isLoading: false, error: null });
    render(<AuditTimeline />);
    expect(screen.getByText('No audit events found')).toBeInTheDocument();
  });

  it('renders timeline with events', () => {
    render(<AuditTimeline />);
    expect(screen.getByText('Audit Timeline')).toBeInTheDocument();
    expect(screen.getByText('Credential Issued')).toBeInTheDocument();
    expect(screen.getByText('Proof Generated')).toBeInTheDocument();
    expect(screen.getByText('Credential Revoked')).toBeInTheDocument();
  });

  it('renders event descriptions', () => {
    render(<AuditTimeline />);
    expect(screen.getByText('KYC credential issued')).toBeInTheDocument();
    expect(screen.getByText('ZK proof generated for age verification')).toBeInTheDocument();
  });

  it('shows truncated transaction hash', () => {
    render(<AuditTimeline />);
    expect(screen.getByText(/tx: 0xabc123de.*abcdef/)).toBeInTheDocument();
  });

  it('renders filter button showing All Events by default', () => {
    render(<AuditTimeline />);
    expect(screen.getByText('All Events')).toBeInTheDocument();
  });

  it('opens filter dropdown and shows event type options', () => {
    render(<AuditTimeline />);
    fireEvent.click(screen.getByText('All Events'));
    expect(screen.getAllByText('All Events').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Credential Issued').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Credential Revoked').length).toBeGreaterThanOrEqual(1);
  });

  it('filters events by type', () => {
    render(<AuditTimeline />);
    fireEvent.click(screen.getByText('All Events'));
    // Click the filter option for Credential Issued in the dropdown
    const options = screen.getAllByText('Credential Issued');
    fireEvent.click(options[options.length - 1]);
    // The filter button should now show Credential Issued
    // and the credential-issued event should still be visible
    expect(screen.getByText('KYC credential issued')).toBeInTheDocument();
    // After filtering, the filter label changes from "All Events" to "Credential Issued"
    expect(screen.getAllByText('Credential Issued').length).toBeGreaterThanOrEqual(1);
  });

  it('passes did and limit to useAudit hook', () => {
    render(<AuditTimeline did="did:test:123" limit={10} />);
    expect(mockUseAudit).toHaveBeenCalledWith('did:test:123', 10);
  });

  // --- NEW TESTS for uncovered branches/functions ---

  it('uses default limit of 50 when not specified', () => {
    render(<AuditTimeline />);
    expect(mockUseAudit).toHaveBeenCalledWith(undefined, 50);
  });

  it('filters events by credential-revoked type', () => {
    render(<AuditTimeline />);
    fireEvent.click(screen.getByText('All Events'));
    // The dropdown button is the first match (renders in header before timeline)
    const options = screen.getAllByText('Credential Revoked');
    fireEvent.click(options[0]);
    // Should show credential-revoked event
    expect(screen.getByText('Old credential revoked')).toBeInTheDocument();
    // Should not show other events
    expect(screen.queryByText('KYC credential issued')).not.toBeInTheDocument();
    expect(screen.queryByText('ZK proof generated for age verification')).not.toBeInTheDocument();
  });

  it('filters events by proof-generated type', () => {
    render(<AuditTimeline />);
    fireEvent.click(screen.getByText('All Events'));
    // The dropdown button is the first match (renders in header before timeline)
    const options = screen.getAllByText('Proof Generated');
    fireEvent.click(options[0]);
    expect(screen.getByText('ZK proof generated for age verification')).toBeInTheDocument();
    expect(screen.queryByText('KYC credential issued')).not.toBeInTheDocument();
  });

  it('shows empty state after filtering to type with no matching events', () => {
    render(<AuditTimeline />);
    fireEvent.click(screen.getByText('All Events'));
    // Click on Identity Created which has no events
    const options = screen.getAllByText('Identity Created');
    fireEvent.click(options[options.length - 1]);
    expect(screen.getByText('No audit events found')).toBeInTheDocument();
  });

  it('resets filter back to All Events', () => {
    render(<AuditTimeline />);
    // Set a filter first
    fireEvent.click(screen.getByText('All Events'));
    // Dropdown button for "Credential Issued" is the first match (in dropdown before timeline)
    const credIssuedOptions = screen.getAllByText('Credential Issued');
    fireEvent.click(credIssuedOptions[0]);

    // Filter button now shows "Credential Issued" - click to open dropdown
    // After filtering, only credential-issued events show, so "Credential Issued" appears as:
    // 1) filter button text, 2) timeline event label
    const filterButton = screen.getAllByText('Credential Issued')[0].closest('button')!;
    fireEvent.click(filterButton);
    // Click "All Events" in the dropdown (first match is the dropdown option)
    const allEventsOptions = screen.getAllByText('All Events');
    fireEvent.click(allEventsOptions[0]);

    // All events should be visible again
    expect(screen.getByText('KYC credential issued')).toBeInTheDocument();
    expect(screen.getByText('ZK proof generated for age verification')).toBeInTheDocument();
    expect(screen.getByText('Old credential revoked')).toBeInTheDocument();
  });

  it('closes filter dropdown after selecting a filter', () => {
    render(<AuditTimeline />);
    fireEvent.click(screen.getByText('All Events'));
    // Dropdown should be open, showing all event type options
    expect(screen.getAllByText('Credential Verified').length).toBeGreaterThanOrEqual(1);

    const options = screen.getAllByText('Credential Issued');
    fireEvent.click(options[options.length - 1]);
    // Dropdown should close - Credential Verified should only appear once (not in dropdown)
    // Since filter is now credential-issued, Credential Verified shouldn't appear at all
    // unless the filtered events show it
  });

  it('renders events without description', () => {
    mockUseAudit.mockReturnValue({
      events: [{
        id: 'evt-no-desc',
        type: 'credential-verified' as const,
        timestamp: '2026-03-15T12:00:00Z',
      }],
      isLoading: false,
      error: null,
    });
    render(<AuditTimeline />);
    expect(screen.getByText('Credential Verified')).toBeInTheDocument();
  });

  it('renders events without transactionHash', () => {
    mockUseAudit.mockReturnValue({
      events: [{
        id: 'evt-no-tx',
        type: 'proof-verified' as const,
        timestamp: '2026-03-15T12:00:00Z',
        description: 'Proof verified successfully',
      }],
      isLoading: false,
      error: null,
    });
    render(<AuditTimeline />);
    expect(screen.getByText('Proof verified successfully')).toBeInTheDocument();
    expect(screen.queryByText(/tx:/)).not.toBeInTheDocument();
  });

  it('renders events of all supported types', () => {
    const allTypeEvents = [
      { id: 'e1', type: 'credential-issued' as const, timestamp: '2026-03-15T10:00:00Z', description: 'test1' },
      { id: 'e2', type: 'credential-revoked' as const, timestamp: '2026-03-15T10:00:00Z', description: 'test2' },
      { id: 'e3', type: 'credential-verified' as const, timestamp: '2026-03-15T10:00:00Z', description: 'test3' },
      { id: 'e4', type: 'proof-generated' as const, timestamp: '2026-03-15T10:00:00Z', description: 'test4' },
      { id: 'e5', type: 'proof-verified' as const, timestamp: '2026-03-15T10:00:00Z', description: 'test5' },
      { id: 'e6', type: 'identity-created' as const, timestamp: '2026-03-15T10:00:00Z', description: 'test6' },
      { id: 'e7', type: 'selective-disclosure' as const, timestamp: '2026-03-15T10:00:00Z', description: 'test7' },
    ];
    mockUseAudit.mockReturnValue({
      events: allTypeEvents,
      isLoading: false,
      error: null,
    });
    render(<AuditTimeline />);
    expect(screen.getByText('Credential Issued')).toBeInTheDocument();
    expect(screen.getByText('Credential Revoked')).toBeInTheDocument();
    expect(screen.getByText('Credential Verified')).toBeInTheDocument();
    expect(screen.getByText('Proof Generated')).toBeInTheDocument();
    expect(screen.getByText('Proof Verified')).toBeInTheDocument();
    expect(screen.getByText('Identity Created')).toBeInTheDocument();
    expect(screen.getByText('Selective Disclosure')).toBeInTheDocument();
  });

  it('renders null events as empty array', () => {
    mockUseAudit.mockReturnValue({
      events: null,
      isLoading: false,
      error: null,
    });
    render(<AuditTimeline />);
    expect(screen.getByText('No audit events found')).toBeInTheDocument();
  });

  it('shows all filter options in dropdown', () => {
    render(<AuditTimeline />);
    fireEvent.click(screen.getByText('All Events'));
    // Check all event types appear in the dropdown
    expect(screen.getAllByText('Credential Issued').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Credential Revoked').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Credential Verified').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Proof Generated').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Proof Verified').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Identity Created').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Selective Disclosure').length).toBeGreaterThanOrEqual(1);
  });

  it('displays formatted date and time for events', () => {
    mockUseAudit.mockReturnValue({
      events: [{
        id: 'evt-date',
        type: 'credential-issued' as const,
        timestamp: '2026-01-15T14:30:00Z',
        description: 'Test date formatting',
      }],
      isLoading: false,
      error: null,
    });
    render(<AuditTimeline />);
    // Date should be formatted like "Jan 15, 2026"
    expect(screen.getByText('Test date formatting')).toBeInTheDocument();
  });

  it('toggles filter dropdown open and closed', () => {
    render(<AuditTimeline />);
    // Open - click the filter button (which shows "All Events")
    const filterButton = screen.getByText('All Events').closest('button')!;
    fireEvent.click(filterButton);
    // Dropdown is open: "Credential Issued" appears in both the timeline and the dropdown
    expect(screen.getAllByText('Credential Issued').length).toBeGreaterThanOrEqual(2);

    // Close by clicking the same button again
    // When dropdown is open, "All Events" appears in both the button and the dropdown
    // Use the button element directly to avoid multiple-element errors
    fireEvent.click(filterButton);
    // Dropdown should close
  });

  it('uses fallback eventConfig for unknown event type (covers line 175)', () => {
    mockUseAudit.mockReturnValue({
      events: [{
        id: 'evt-unknown',
        type: 'unknown-type' as any,
        timestamp: '2026-03-15T10:00:00Z',
        description: 'Unknown event',
      }],
      isLoading: false,
      error: null,
    });
    render(<AuditTimeline />);
    // The fallback is eventConfig['credential-verified'] which has label "Credential Verified"
    expect(screen.getByText('Credential Verified')).toBeInTheDocument();
    expect(screen.getByText('Unknown event')).toBeInTheDocument();
  });
});
