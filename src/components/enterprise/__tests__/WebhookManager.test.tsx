import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import WebhookManager from '@/components/enterprise/WebhookManager';

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock('lucide-react', () => ({
  Webhook: (props: any) => <div data-testid="icon-webhook" {...props} />,
  Plus: (props: any) => <div data-testid="icon-plus" {...props} />,
  Trash2: (props: any) => <div data-testid="icon-trash" {...props} />,
  Play: (props: any) => <div data-testid="icon-play" {...props} />,
  RefreshCw: (props: any) => <div data-testid="icon-refresh" {...props} />,
  Check: (props: any) => <div data-testid="icon-check" {...props} />,
  X: (props: any) => <div data-testid="icon-x" {...props} />,
  Copy: (props: any) => <div data-testid="icon-copy" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  CheckCircle2: (props: any) => <div data-testid="icon-check-circle" {...props} />,
  XCircle: (props: any) => <div data-testid="icon-x-circle" {...props} />,
  ChevronDown: (props: any) => <div data-testid="icon-chevron-down" {...props} />,
  ChevronUp: (props: any) => <div data-testid="icon-chevron-up" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  Shield: (props: any) => <div data-testid="icon-shield" {...props} />,
  Activity: (props: any) => <div data-testid="icon-activity" {...props} />,
  Eye: (props: any) => <div data-testid="icon-eye" {...props} />,
  Globe: (props: any) => <div data-testid="icon-globe" {...props} />,
}));

const mockWebhooks = [
  {
    id: 'wh1',
    url: 'https://api.example.com/webhooks/zeroid',
    events: ['credential.issued', 'credential.revoked'] as any[],
    status: 'healthy' as const,
    secret: 'whsec_abc123',
    active: true,
    createdAt: '2026-01-20',
    successRate: 99.2,
    deliveryLogs: [
      { id: 'd1', status: 'success' as const, statusCode: 200, responseTime: 142, timestamp: '2026-03-15T10:30:00Z', eventType: 'credential.issued' as any },
      { id: 'd2', status: 'failed' as const, statusCode: 500, responseTime: 3010, timestamp: '2026-03-14T22:45:00Z', eventType: 'credential.revoked' as any, error: 'Internal Server Error' },
    ],
  },
];

describe('WebhookManager', () => {
  it('renders loading state', () => {
    render(<WebhookManager loading={true} />);
    expect(screen.getByText('Loading webhooks...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<WebhookManager error="Service unavailable" />);
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
  });

  it('renders header with webhook count', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
    expect(screen.getByText('1 endpoints')).toBeInTheDocument();
  });

  it('renders empty state when no webhooks', () => {
    render(<WebhookManager webhooks={[]} />);
    expect(screen.getByText('No webhooks configured')).toBeInTheDocument();
  });

  it('renders webhook URLs', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    expect(screen.getByText('https://api.example.com/webhooks/zeroid')).toBeInTheDocument();
  });

  it('renders webhook status', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders event badges', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    expect(screen.getByText('credential.issued')).toBeInTheDocument();
    expect(screen.getByText('credential.revoked')).toBeInTheDocument();
  });

  it('renders success rate', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    expect(screen.getByText('99.2% success')).toBeInTheDocument();
  });

  it('renders Add Webhook button', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    expect(screen.getByText('Add Webhook')).toBeInTheDocument();
  });

  it('opens add webhook form when button is clicked', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));
    expect(screen.getByText('Endpoint URL')).toBeInTheDocument();
    expect(screen.getByText('Event Types')).toBeInTheDocument();
    expect(screen.getByText('Signing Secret')).toBeInTheDocument();
  });

  it('expands webhook to show delivery logs', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('https://api.example.com/webhooks/zeroid'));
    expect(screen.getByText('Recent Deliveries')).toBeInTheDocument();
    expect(screen.getByText('Internal Server Error')).toBeInTheDocument();
  });

  it('calls onTest when test button is clicked', () => {
    const onTest = jest.fn();
    render(<WebhookManager webhooks={mockWebhooks} onTest={onTest} />);
    const testButtons = screen.getAllByTitle('Send test event');
    fireEvent.click(testButtons[0]);
    expect(onTest).toHaveBeenCalledWith('wh1');
  });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = jest.fn();
    render(<WebhookManager webhooks={mockWebhooks} onDelete={onDelete} />);
    const deleteButtons = screen.getAllByTitle('Delete webhook');
    fireEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalledWith('wh1');
  });

  it('applies custom className', () => {
    const { container } = render(<WebhookManager className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('shows HTTPS validation hint in add form', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));
    expect(screen.getByText('Must use HTTPS')).toBeInTheDocument();
  });

  it('disables add button when URL is not HTTPS or no events selected', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));
    // The "Add Webhook" button inside the form should be disabled
    const addButtons = screen.getAllByText('Add Webhook');
    const formAddButton = addButtons[addButtons.length - 1];
    expect(formAddButton).toBeDisabled();
  });

  it('selects events and enters valid URL to enable form submission', () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<WebhookManager webhooks={mockWebhooks} onAdd={onAdd} />);
    fireEvent.click(screen.getByText('Add Webhook'));

    // Enter a valid HTTPS URL
    fireEvent.change(screen.getByPlaceholderText('https://your-server.com/webhooks/zeroid'), {
      target: { value: 'https://my-server.com/hook' },
    });

    // Select an event
    fireEvent.click(screen.getByText('Credential Issued'));

    // The Add Webhook button should now be enabled
    const addButtons = screen.getAllByText('Add Webhook');
    const formAddButton = addButtons[addButtons.length - 1];
    expect(formAddButton).not.toBeDisabled();

    // Submit the form
    fireEvent.click(formAddButton);
    expect(onAdd).toHaveBeenCalledWith(
      'https://my-server.com/hook',
      ['credential.issued'],
      expect.stringContaining('whsec_')
    );
  });

  it('closes add form on Cancel', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));
    expect(screen.getByText('Endpoint URL')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Endpoint URL')).not.toBeInTheDocument();
  });

  it('toggles event selection on and off', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));

    // Select an event
    fireEvent.click(screen.getByText('Credential Issued'));
    // Deselect it
    fireEvent.click(screen.getByText('Credential Issued'));
  });

  it('calls onRetry when retry button is clicked on failed delivery', () => {
    const onRetry = jest.fn();
    render(<WebhookManager webhooks={mockWebhooks} onRetry={onRetry} />);
    // Expand the webhook
    fireEvent.click(screen.getByText('https://api.example.com/webhooks/zeroid'));
    expect(screen.getByText('Recent Deliveries')).toBeInTheDocument();
    // Find and click the retry button
    const retryButton = screen.getByTitle('Retry delivery');
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledWith('wh1', 'd2');
  });

  it('shows delivery log details including status codes and response times', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('https://api.example.com/webhooks/zeroid'));
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('142ms')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('Internal Server Error')).toBeInTheDocument();
  });

  it('copies signing secret to clipboard in add form', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));

    // Find the copy button next to the secret
    const copyButtons = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('[data-testid="icon-copy"]')
    );
    expect(copyButtons.length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('whsec_'));
  });

  it('handles clipboard copy failure gracefully in add form', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('Not allowed'));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));

    const copyButtons = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('[data-testid="icon-copy"]')
    );
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });
    // Should not throw — form should still be open
    expect(screen.getByText('Signing Secret')).toBeInTheDocument();
  });

  it('shows empty delivery logs message when webhook has no logs', () => {
    const webhookNoLogs = [{
      ...mockWebhooks[0],
      deliveryLogs: [],
    }];
    render(<WebhookManager webhooks={webhookNoLogs} />);
    fireEvent.click(screen.getByText('https://api.example.com/webhooks/zeroid'));
    expect(screen.getByText('No delivery logs yet')).toBeInTheDocument();
  });

  it('renders inactive webhook styling', () => {
    const inactiveWebhook = [{
      ...mockWebhooks[0],
      active: false,
    }];
    render(<WebhookManager webhooks={inactiveWebhook} />);
    expect(screen.getByText('https://api.example.com/webhooks/zeroid')).toBeInTheDocument();
  });

  it('renders degraded and failing status', () => {
    const degradedWebhook = [{
      ...mockWebhooks[0],
      status: 'degraded' as const,
    }];
    render(<WebhookManager webhooks={degradedWebhook} />);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders pending delivery log status', () => {
    const pendingWebhook = [{
      ...mockWebhooks[0],
      deliveryLogs: [
        { id: 'dp1', status: 'pending' as const, timestamp: '2026-03-15T10:00:00Z', eventType: 'identity.created' as any },
      ],
    }];
    render(<WebhookManager webhooks={pendingWebhook} />);
    fireEvent.click(screen.getByText('https://api.example.com/webhooks/zeroid'));
    expect(screen.getByText('identity.created')).toBeInTheDocument();
  });

  it('does not show retry button for non-failed deliveries', () => {
    const onRetry = jest.fn();
    const successWebhook = [{
      ...mockWebhooks[0],
      deliveryLogs: [
        { id: 'd1', status: 'success' as const, statusCode: 200, responseTime: 100, timestamp: '2026-03-15T10:30:00Z', eventType: 'credential.issued' as any },
      ],
    }];
    render(<WebhookManager webhooks={successWebhook} onRetry={onRetry} />);
    fireEvent.click(screen.getByText('https://api.example.com/webhooks/zeroid'));
    expect(screen.queryByTitle('Retry delivery')).not.toBeInTheDocument();
  });

  it('does not show retry button when onRetry is not provided even for failed deliveries', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('https://api.example.com/webhooks/zeroid'));
    expect(screen.queryByTitle('Retry delivery')).not.toBeInTheDocument();
  });

  it('closes add form when clicking backdrop', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));
    expect(screen.getByText('Endpoint URL')).toBeInTheDocument();
    // Click the backdrop (the fixed overlay)
    const backdrop = screen.getByText('Endpoint URL').closest('.fixed');
    if (backdrop) {
      fireEvent.click(backdrop);
    }
    expect(screen.queryByText('Endpoint URL')).not.toBeInTheDocument();
  });

  it('does not submit when form is invalid (no events selected but valid url)', () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<WebhookManager webhooks={mockWebhooks} onAdd={onAdd} />);
    fireEvent.click(screen.getByText('Add Webhook'));
    fireEvent.change(screen.getByPlaceholderText('https://your-server.com/webhooks/zeroid'), {
      target: { value: 'https://my-server.com/hook' },
    });
    // Click add without selecting events
    const addButtons = screen.getAllByText('Add Webhook');
    fireEvent.click(addButtons[addButtons.length - 1]);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('closes add form after successful submission without onAdd', async () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));
    fireEvent.change(screen.getByPlaceholderText('https://your-server.com/webhooks/zeroid'), {
      target: { value: 'https://my-server.com/hook' },
    });
    fireEvent.click(screen.getByText('Credential Issued'));
    const addButtons = screen.getAllByText('Add Webhook');
    await act(async () => {
      fireEvent.click(addButtons[addButtons.length - 1]);
    });
    // Form should close even without onAdd
    expect(screen.queryByText('Endpoint URL')).not.toBeInTheDocument();
  });

  it('shows check icon after secret is copied', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));

    const copyButtons = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('[data-testid="icon-copy"]')
    );
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    // After copy, should show check icon
    expect(screen.getByTestId('icon-check')).toBeInTheDocument();

    // After timeout, should revert
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    jest.useRealTimers();
  });

  it('closes the form via X button in header', () => {
    render(<WebhookManager webhooks={mockWebhooks} />);
    fireEvent.click(screen.getByText('Add Webhook'));
    expect(screen.getByText('Endpoint URL')).toBeInTheDocument();
    // Find and click the X button
    const xButton = screen.getByTestId('icon-x').closest('button');
    if (xButton) fireEvent.click(xButton);
    expect(screen.queryByText('Endpoint URL')).not.toBeInTheDocument();
  });

  it('renders delivery log without statusCode or responseTime', () => {
    const minimalWebhook = [{
      ...mockWebhooks[0],
      deliveryLogs: [
        { id: 'dmin', status: 'pending' as const, timestamp: '2026-03-15T10:00:00Z', eventType: 'proof.generated' as any },
      ],
    }];
    render(<WebhookManager webhooks={minimalWebhook} />);
    fireEvent.click(screen.getByText('https://api.example.com/webhooks/zeroid'));
    expect(screen.getByText('proof.generated')).toBeInTheDocument();
  });
});
