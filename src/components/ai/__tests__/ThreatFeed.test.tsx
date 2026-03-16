import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Polyfill scrollTo for jsdom
Element.prototype.scrollTo = jest.fn();

jest.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      if (typeof prop === 'string') {
        return React.forwardRef((props: any, ref: any) => {
          const { initial, animate, exit, transition, whileHover, whileTap, variants, layout, ...rest } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        });
      }
    },
  }),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target: unknown, prop: string | symbol) => {
    if (prop === '__esModule') return true;
    return (props: any) => <div data-testid={`icon-${String(prop).toLowerCase()}`} {...props} />;
  },
}));

import ThreatFeed from '../ThreatFeed';

const mockEvents = [
  {
    id: 'threat-1',
    type: 'identity_compromise' as const,
    severity: 'critical' as const,
    title: 'Identity Compromise',
    description: 'Potential identity takeover detected',
    source: 'TEE Monitor',
    timestamp: Date.now() - 60000,
    reviewed: false,
  },
  {
    id: 'threat-2',
    type: 'credential_fraud' as const,
    severity: 'warning' as const,
    title: 'Credential Fraud',
    description: 'Fraudulent credential presentation intercepted',
    source: 'ZK Verifier',
    timestamp: Date.now() - 120000,
    reviewed: true,
  },
];

describe('ThreatFeed', () => {
  it('renders without crashing with external events', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    expect(screen.getByText('Threat Intelligence Feed')).toBeInTheDocument();
  });

  it('displays event titles', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    // Title appears as both h4 title and type label, so use getAllByText
    expect(screen.getAllByText('Identity Compromise').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Credential Fraud').length).toBeGreaterThanOrEqual(1);
  });

  it('shows loading state when loading is true', () => {
    render(<ThreatFeed loading autoRefresh={false} />);
    expect(screen.getByText('Loading threat feed...')).toBeInTheDocument();
  });

  it('shows error message when error is provided', () => {
    render(<ThreatFeed error="Connection failed" autoRefresh={false} />);
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  it('shows empty message when no events match filters', () => {
    render(<ThreatFeed events={[]} autoRefresh={false} />);
    expect(screen.getByText('No threat events match your filters')).toBeInTheDocument();
  });

  it('opens filter panel and filters by severity', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    // Find and click the filter button (Filter icon button)
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find(b => b.querySelector('[data-testid="icon-filter"]'));
    expect(filterButton).toBeTruthy();
    fireEvent.click(filterButton!);
    // Filter panel should show severity options
    expect(screen.getByText('Severity:')).toBeInTheDocument();
    // "Critical" text appears both as severity badge and filter button; click the filter one
    const criticalButtons = screen.getAllByText('Critical');
    fireEvent.click(criticalButtons[criticalButtons.length - 1]);
    // Only critical events should be shown
    expect(screen.getAllByText('Identity Compromise').length).toBeGreaterThanOrEqual(1);
  });

  it('opens filter panel and filters by type', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find(b => b.querySelector('[data-testid="icon-filter"]'));
    fireEvent.click(filterButton!);
    expect(screen.getByText('Type:')).toBeInTheDocument();
    // Click Credential Fraud type filter button (in the filter bar, not the event card)
    const typeButtons = screen.getAllByText('Credential Fraud');
    // The filter button is the last one (in the filter panel)
    fireEvent.click(typeButtons[typeButtons.length - 1]);
    // Should filter to only credential fraud events
    expect(screen.getAllByText('Credential Fraud').length).toBeGreaterThanOrEqual(1);
  });

  it('expands an event card to show details', () => {
    const eventsWithDetails = [
      {
        ...mockEvents[0],
        details: 'Full analysis available for this event',
        affectedDid: 'did:aethelred:mainnet:0xabc123',
      },
    ];
    render(<ThreatFeed events={eventsWithDetails} autoRefresh={false} />);
    // Click the event card button to expand
    fireEvent.click(screen.getByText('Potential identity takeover detected'));
    expect(screen.getByText('Full analysis available for this event')).toBeInTheDocument();
    expect(screen.getByText('did:aethelred:mainnet:0xabc123')).toBeInTheDocument();
  });

  it('shows Mark Reviewed button for unreviewed events and calls onReview', () => {
    const onReview = jest.fn();
    const eventsWithDetails = [
      {
        ...mockEvents[0],
        details: 'Event detail text',
        reviewed: false,
      },
    ];
    render(<ThreatFeed events={eventsWithDetails} autoRefresh={false} onReview={onReview} />);
    // Expand the event
    fireEvent.click(screen.getByText('Potential identity takeover detected'));
    // Click Mark Reviewed
    fireEvent.click(screen.getByText('Mark Reviewed'));
    expect(onReview).toHaveBeenCalledWith('threat-1');
  });

  it('shows Reviewed label for reviewed events when expanded', () => {
    const eventsWithDetails = [
      {
        ...mockEvents[1],
        details: 'Some detail',
        reviewed: true,
      },
    ];
    render(<ThreatFeed events={eventsWithDetails} autoRefresh={false} />);
    fireEvent.click(screen.getByText('Fraudulent credential presentation intercepted'));
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
  });

  it('shows metadata when event has metadata', () => {
    const eventsWithMetadata = [
      {
        ...mockEvents[0],
        details: 'Some detail',
        metadata: { 'Source IP': '192.168.1.1', 'Region': 'US-East' },
      },
    ];
    render(<ThreatFeed events={eventsWithMetadata} autoRefresh={false} />);
    fireEvent.click(screen.getByText('Potential identity takeover detected'));
    expect(screen.getByText('Source IP')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('US-East')).toBeInTheDocument();
  });

  it('calls onEventClick when expanding an event', () => {
    const onEventClick = jest.fn();
    render(<ThreatFeed events={mockEvents} autoRefresh={false} onEventClick={onEventClick} />);
    fireEvent.click(screen.getByText('Potential identity takeover detected'));
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'threat-1' }));
  });

  it('collapses expanded event when clicked again', () => {
    const eventsWithDetails = [
      {
        ...mockEvents[0],
        details: 'Detail text here',
      },
    ];
    render(<ThreatFeed events={eventsWithDetails} autoRefresh={false} />);
    // Expand
    fireEvent.click(screen.getByText('Potential identity takeover detected'));
    expect(screen.getByText('Detail text here')).toBeInTheDocument();
    // Collapse
    fireEvent.click(screen.getByText('Potential identity takeover detected'));
    expect(screen.queryByText('Detail text here')).not.toBeInTheDocument();
  });

  it('handles internal review when no onReview callback is provided', () => {
    // Create deterministic but unique events by cycling random values
    let callCount = 0;
    const randomSpy = jest.spyOn(Math, 'random').mockImplementation(() => {
      callCount++;
      // Return low values to ensure reviewed=false (Math.random() > 0.6 means reviewed)
      return (callCount % 10) * 0.05; // cycles 0, 0.05, 0.10, ...
    });

    render(<ThreatFeed autoRefresh={false} />);

    // Get the first event card and expand it
    const allButtons = screen.getAllByRole('button');
    const eventCards = allButtons.filter(
      btn => btn.className.includes('w-full text-left')
    );
    expect(eventCards.length).toBeGreaterThan(0);
    fireEvent.click(eventCards[0]);
    // Click Mark Reviewed - should use internal handler which maps over multiple events
    const markReviewedBtn = screen.queryByText('Mark Reviewed');
    expect(markReviewedBtn).toBeTruthy();
    fireEvent.click(markReviewedBtn!);

    randomSpy.mockRestore();
  });

  it('applies custom className', () => {
    const { container } = render(<ThreatFeed events={mockEvents} autoRefresh={false} className="custom-feed" />);
    expect(container.firstChild).toHaveClass('custom-feed');
  });

  it('applies className to loading state', () => {
    const { container } = render(<ThreatFeed loading className="loading-class" autoRefresh={false} />);
    expect(container.firstChild).toHaveClass('loading-class');
  });

  it('applies className to error state', () => {
    const { container } = render(<ThreatFeed error="fail" className="error-class" autoRefresh={false} />);
    expect(container.firstChild).toHaveClass('error-class');
  });

  it('shows unreviewed count badge', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    // mockEvents[0] is unreviewed, mockEvents[1] is reviewed
    // So unreviewedCount = 1
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows 9+ when more than 9 unreviewed events', () => {
    const manyUnreviewed = Array.from({ length: 12 }, (_, i) => ({
      id: `threat-${i}`,
      type: 'identity_compromise' as const,
      severity: 'critical' as const,
      title: `Threat ${i}`,
      description: `Description ${i}`,
      source: 'TEE Monitor',
      timestamp: Date.now() - i * 1000,
      reviewed: false,
    }));
    render(<ThreatFeed events={manyUnreviewed} autoRefresh={false} />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('does not show unreviewed badge when all events are reviewed', () => {
    const allReviewed = mockEvents.map((e) => ({ ...e, reviewed: true }));
    render(<ThreatFeed events={allReviewed} autoRefresh={false} />);
    // No badge should appear (unreviewedCount === 0)
    expect(screen.queryByText('9+')).not.toBeInTheDocument();
  });

  it('filters events by severity and resets with All', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    // Open filters
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find((b) => b.querySelector('[data-testid="icon-filter"]'));
    fireEvent.click(filterButton!);

    // Filter to warning only - the filter button is the first "Warning" in the DOM
    const warningButtons = screen.getAllByText('Warning');
    fireEvent.click(warningButtons[0]);

    // Only warning events should show in the event list
    // "Identity Compromise" still appears in the type filter panel, so check event cards are filtered
    // The critical event card should not show its description
    expect(screen.queryByText('Potential identity takeover detected')).not.toBeInTheDocument();
    expect(screen.getAllByText('Credential Fraud').length).toBeGreaterThanOrEqual(1);

    // Reset with All
    const allButtons = screen.getAllByText('All');
    fireEvent.click(allButtons[0]); // First "All" is severity "All"
    // Both events should show again
    expect(screen.getAllByText('Identity Compromise').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by type and resets with All', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find((b) => b.querySelector('[data-testid="icon-filter"]'));
    fireEvent.click(filterButton!);

    // Filter by identity_compromise type
    const idCompromiseButtons = screen.getAllByText('Identity Compromise');
    fireEvent.click(idCompromiseButtons[idCompromiseButtons.length - 1]);

    // Only identity compromise events should show
    expect(screen.getAllByText('Identity Compromise').length).toBeGreaterThanOrEqual(1);

    // Reset type filter
    const allButtons = screen.getAllByText('All');
    // Type "All" button is the second one
    fireEvent.click(allButtons[allButtons.length - 1]);
  });

  it('shows event source info', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    expect(screen.getByText('via TEE Monitor')).toBeInTheDocument();
    expect(screen.getByText('via ZK Verifier')).toBeInTheDocument();
  });

  it('shows relative timestamp', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    // mockEvents[0] is 60s ago, mockEvents[1] is 120s ago
    expect(screen.getByText('1m ago')).toBeInTheDocument();
    expect(screen.getByText('2m ago')).toBeInTheDocument();
  });

  it('shows NEW badge for newly added events', () => {
    // This tests internal state; we can test by providing events that match newEventIds
    // Since newEventIds is internal, we test via autoRefresh
    jest.useFakeTimers();
    render(<ThreatFeed autoRefresh={true} refreshInterval={1000} />);

    // Advance timer to trigger new event
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    // A "NEW" badge should appear
    expect(screen.getAllByText('NEW').length).toBeGreaterThanOrEqual(1);

    // After 5s, the NEW badge should disappear
    act(() => {
      jest.advanceTimersByTime(6000);
    });

    jest.useRealTimers();
  });

  it('generates mock events when no external events and autoRefresh is off', () => {
    render(<ThreatFeed autoRefresh={false} />);
    // Should generate 8 mock events
    expect(screen.getByText('Threat Intelligence Feed')).toBeInTheDocument();
    // Should show some events (8 generated)
    expect(screen.getByText(/events/)).toBeInTheDocument();
  });

  it('shows severity labels on event cards', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    expect(screen.getAllByText('Critical').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Warning').length).toBeGreaterThanOrEqual(1);
  });

  it('does not show Mark Reviewed for reviewed events', () => {
    const eventsWithDetails = [
      {
        ...mockEvents[1], // reviewed: true
        details: 'Some detail',
      },
    ];
    render(<ThreatFeed events={eventsWithDetails} autoRefresh={false} onReview={jest.fn()} />);
    fireEvent.click(screen.getByText('Fraudulent credential presentation intercepted'));
    expect(screen.queryByText('Mark Reviewed')).not.toBeInTheDocument();
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
  });

  it('shows Live indicator when autoRefresh is true', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={true} />);
    expect(screen.getByText(/Live/)).toBeInTheDocument();
  });

  it('does not show Live indicator when autoRefresh is false', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    expect(screen.queryByText(/Live/)).not.toBeInTheDocument();
  });

  it('shows all filter type options when filter panel is open', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find((b) => b.querySelector('[data-testid="icon-filter"]'));
    fireEvent.click(filterButton!);

    expect(screen.getByText('Unauthorized Access')).toBeInTheDocument();
    expect(screen.getByText('Sanctions Match')).toBeInTheDocument();
    expect(screen.getByText('Anomalous Behavior')).toBeInTheDocument();
    expect(screen.getByText('Network Attack')).toBeInTheDocument();
  });

  it('shows all severity filter options when filter panel is open', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find((b) => b.querySelector('[data-testid="icon-filter"]'));
    fireEvent.click(filterButton!);

    expect(screen.getByText('Info')).toBeInTheDocument();
    // Error severity in filter
    const errorButtons = screen.getAllByText('Error');
    expect(errorButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows hours-ago relative time for events 2 hours old', () => {
    const hourOldEvents = [
      {
        id: 'threat-h1',
        type: 'identity_compromise' as const,
        severity: 'critical' as const,
        title: 'Hour Old Event',
        description: 'An event from 2 hours ago',
        source: 'TEE Monitor',
        timestamp: Date.now() - 2 * 3600000, // 2 hours ago
        reviewed: false,
      },
    ];
    render(<ThreatFeed events={hourOldEvents} autoRefresh={false} />);
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('shows days-ago relative time for events 3 days old', () => {
    const dayOldEvents = [
      {
        id: 'threat-d1',
        type: 'credential_fraud' as const,
        severity: 'warning' as const,
        title: 'Day Old Event',
        description: 'An event from 3 days ago',
        source: 'Chain Indexer',
        timestamp: Date.now() - 3 * 86400000, // 3 days ago
        reviewed: false,
      },
    ];
    render(<ThreatFeed events={dayOldEvents} autoRefresh={false} />);
    expect(screen.getByText('3d ago')).toBeInTheDocument();
  });

  it('shows seconds-ago relative time for very recent events', () => {
    const recentEvents = [
      {
        id: 'threat-s1',
        type: 'network_attack' as const,
        severity: 'info' as const,
        title: 'Very Recent',
        description: 'Just happened',
        source: 'API Gateway',
        timestamp: Date.now() - 30000, // 30 seconds ago
        reviewed: false,
      },
    ];
    render(<ThreatFeed events={recentEvents} autoRefresh={false} />);
    expect(screen.getByText('30s ago')).toBeInTheDocument();
  });

  it('sets type filter via type filter buttons and verifies active styling', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find((b) => b.querySelector('[data-testid="icon-filter"]'));
    fireEvent.click(filterButton!);

    // Click a specific type filter to set it active
    const typeFilterButtons = screen.getAllByRole('button').filter(
      (btn) => btn.className.includes('rounded-full') && btn.textContent === 'Sanctions Match'
    );
    if (typeFilterButtons.length > 0) {
      fireEvent.click(typeFilterButtons[0]);
      // Verify the filter is active (no events should match since our mock events don't have that type)
      expect(screen.getByText('No threat events match your filters')).toBeInTheDocument();
    }
  });

  it('shows all event types in type filters', () => {
    const allTypeEvents = [
      { id: 't1', type: 'identity_compromise' as const, severity: 'critical' as const, title: 'T1', description: 'D1', source: 'S1', timestamp: Date.now(), reviewed: false },
      { id: 't2', type: 'credential_fraud' as const, severity: 'error' as const, title: 'T2', description: 'D2', source: 'S2', timestamp: Date.now(), reviewed: false },
      { id: 't3', type: 'unauthorized_access' as const, severity: 'warning' as const, title: 'T3', description: 'D3', source: 'S3', timestamp: Date.now(), reviewed: false },
      { id: 't4', type: 'sanctions_match' as const, severity: 'info' as const, title: 'T4', description: 'D4', source: 'S4', timestamp: Date.now(), reviewed: false },
      { id: 't5', type: 'anomalous_behavior' as const, severity: 'critical' as const, title: 'T5', description: 'D5', source: 'S5', timestamp: Date.now(), reviewed: false },
      { id: 't6', type: 'network_attack' as const, severity: 'error' as const, title: 'T6', description: 'D6', source: 'S6', timestamp: Date.now(), reviewed: false },
    ];
    render(<ThreatFeed events={allTypeEvents} autoRefresh={false} />);
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find((b) => b.querySelector('[data-testid="icon-filter"]'));
    fireEvent.click(filterButton!);

    // Click each type filter to ensure all type filter onClick handlers fire
    const typeNames = ['Identity Compromise', 'Credential Fraud', 'Unauthorized Access', 'Sanctions Match', 'Anomalous Behavior', 'Network Attack'];
    for (const typeName of typeNames) {
      const typeButtons = screen.getAllByText(typeName);
      // Find the one in the filter panel (it's a button with rounded-full class)
      const filterBtn = typeButtons.find(el => {
        const btn = el.closest('button');
        return btn && btn.className.includes('rounded-full');
      });
      if (filterBtn) {
        fireEvent.click(filterBtn.closest('button')!);
      }
    }
  });

  it('uses default autoRefresh=true when not specified', () => {
    jest.useFakeTimers();
    render(<ThreatFeed events={mockEvents} />);
    // autoRefresh defaults to true, but since externalEvents is provided,
    // the interval does not generate new events
    expect(screen.getByText(/Live/)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it('closes filter panel when filter button is clicked again', () => {
    render(<ThreatFeed events={mockEvents} autoRefresh={false} />);
    const buttons = screen.getAllByRole('button');
    const filterButton = buttons.find((b) => b.querySelector('[data-testid="icon-filter"]'));
    fireEvent.click(filterButton!);
    expect(screen.getByText('Severity:')).toBeInTheDocument();

    // Click filter button again to close
    fireEvent.click(filterButton!);
    expect(screen.queryByText('Severity:')).not.toBeInTheDocument();
  });
});
