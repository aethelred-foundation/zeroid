import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/credentials',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: any, prop: string) => {
      return React.forwardRef((props: any, ref: any) => {
        const { initial, animate, exit, transition, whileHover, whileTap, variants, layout, layoutId, ...rest } = props;
        const Tag = prop as any;
        return <Tag ref={ref} {...rest} />;
      });
    },
  }),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock AppLayout
jest.mock('@/components/layout/AppLayout', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="app-layout">{children}</div>,
}));

// Mock hooks
jest.mock('@/hooks/useCredentials', () => ({
  useCredentials: jest.fn(() => ({
    data: {
      credentials: [
        { id: '1', status: 'active', schemaType: 'KYC Verification' },
        { id: '2', status: 'pending', schemaType: 'Age Verification' },
        { id: '3', status: 'expired', schemaType: 'Residency Proof' },
      ],
    },
    isLoading: false,
  })),
}));

// Mock components
jest.mock('@/components/credentials/CredentialCard', () => ({
  __esModule: true,
  default: ({ credential }: any) => <div data-testid="credential-card">{credential.schemaType}</div>,
}));

jest.mock('@/components/credentials/CredentialRequest', () => ({
  __esModule: true,
  default: () => <div data-testid="credential-request">CredentialRequest</div>,
}));

jest.mock('@/components/credentials/CredentialList', () => ({
  __esModule: true,
  default: () => <div data-testid="credential-list">CredentialList</div>,
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, title, onClose }: any) =>
    open ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        <button data-testid="modal-close" onClick={onClose}>Close</button>
        {children}
      </div>
    ) : null,
}));

import CredentialsPage from '../page';

describe('CredentialsPage', () => {
  it('renders without crashing', () => {
    render(<CredentialsPage />);
    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
  });

  it('displays the page heading', () => {
    render(<CredentialsPage />);
    expect(screen.getByText('Credentials')).toBeInTheDocument();
    expect(screen.getByText(/Manage your verifiable credentials/)).toBeInTheDocument();
  });

  it('renders credential cards in grid view', () => {
    render(<CredentialsPage />);
    const cards = screen.getAllByTestId('credential-card');
    expect(cards.length).toBe(3);
  });

  it('opens request modal when Request Credential is clicked', () => {
    render(<CredentialsPage />);
    // There may be multiple "Request Credential" buttons; click the first one (header button)
    const buttons = screen.getAllByText('Request Credential');
    fireEvent.click(buttons[0]);
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByTestId('credential-request')).toBeInTheDocument();
  });

  it('shows available credential schemas', () => {
    render(<CredentialsPage />);
    expect(screen.getByText('Available Credential Schemas')).toBeInTheDocument();
    expect(screen.getAllByText('Age Verification').length).toBeGreaterThan(0);
    expect(screen.getAllByText('KYC Verification').length).toBeGreaterThan(0);
  });

  it('filters credentials by search query', () => {
    render(<CredentialsPage />);
    const searchInput = screen.getByPlaceholderText('Search credentials by type, issuer...');
    fireEvent.change(searchInput, { target: { value: 'KYC' } });
    // Only KYC Verification should match the search
    const cards = screen.getAllByTestId('credential-card');
    expect(cards.length).toBe(1);
    expect(cards[0]).toHaveTextContent('KYC Verification');
  });

  it('filters credentials by status', () => {
    render(<CredentialsPage />);
    // Click 'Active' status filter
    fireEvent.click(screen.getByText('Active'));
    const cards = screen.getAllByTestId('credential-card');
    expect(cards.length).toBe(1);
    expect(cards[0]).toHaveTextContent('KYC Verification');
  });

  it('shows empty state with appropriate message for filtered results', () => {
    render(<CredentialsPage />);
    // Filter by 'Revoked' - there are no revoked credentials in mock data
    fireEvent.click(screen.getByText('Revoked'));
    expect(screen.getByText('No credentials found')).toBeInTheDocument();
    expect(screen.getByText('No revoked credentials')).toBeInTheDocument();
  });

  it('switches to list view mode', () => {
    render(<CredentialsPage />);
    // Find view toggle buttons - they are the grid/list icon buttons
    const allButtons = screen.getAllByRole('button');
    // The list view button is the second of two adjacent icon-only buttons
    const listBtn = allButtons.find(btn => {
      const classes = btn.getAttribute('class') || '';
      return classes.includes('p-2.5') && btn.querySelector('svg') && !classes.includes('bg-brand-600');
    });
    fireEvent.click(listBtn!);
    expect(screen.getByTestId('credential-list')).toBeInTheDocument();
  });

  it('opens request modal when schema type button is clicked', () => {
    render(<CredentialsPage />);
    // Click on a schema type button (e.g., "Nationality")
    fireEvent.click(screen.getByText('Nationality'));
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByTestId('credential-request')).toBeInTheDocument();
  });

  it('shows empty state with Request Credential button when no credentials and filter is all', () => {
    const { useCredentials } = require('@/hooks/useCredentials');
    useCredentials.mockReturnValueOnce({
      data: { credentials: [] },
      isLoading: false,
    });
    render(<CredentialsPage />);
    expect(screen.getByText('No credentials found')).toBeInTheDocument();
    expect(screen.getByText('Request your first credential to get started')).toBeInTheDocument();
  });

  it('opens request modal from empty state Request Credential button', () => {
    const { useCredentials } = require('@/hooks/useCredentials');
    useCredentials.mockReturnValueOnce({
      data: { credentials: [] },
      isLoading: false,
    });
    render(<CredentialsPage />);
    // In the empty state with filter='all', there are two Request Credential buttons (header + empty state)
    const buttons = screen.getAllByText('Request Credential');
    // Click the last one (empty state button)
    fireEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByTestId('modal')).toBeInTheDocument();
  });

  it('switches back to grid view from list view', () => {
    render(<CredentialsPage />);
    // First switch to list view
    const allButtons = screen.getAllByRole('button');
    const listBtn = allButtons.find(btn => {
      const classes = btn.getAttribute('class') || '';
      return classes.includes('p-2.5') && !classes.includes('bg-brand-600');
    });
    fireEvent.click(listBtn!);
    expect(screen.getByTestId('credential-list')).toBeInTheDocument();

    // Now switch back to grid view
    const allButtons2 = screen.getAllByRole('button');
    const gridBtn = allButtons2.find(btn => {
      const classes = btn.getAttribute('class') || '';
      return classes.includes('p-2.5') && classes.includes('bg-brand-600');
    });
    // The grid button should now be inactive — find it by position (first p-2.5 button)
    const viewButtons = allButtons2.filter(btn => (btn.getAttribute('class') || '').includes('p-2.5'));
    fireEvent.click(viewButtons[0]); // first is grid
    const cards = screen.getAllByTestId('credential-card');
    expect(cards.length).toBe(3);
  });

  it('closes the request modal via onClose', () => {
    render(<CredentialsPage />);
    const buttons = screen.getAllByText('Request Credential');
    fireEvent.click(buttons[0]);
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('handles undefined data from useCredentials', () => {
    const { useCredentials } = require('@/hooks/useCredentials');
    useCredentials.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
    });
    render(<CredentialsPage />);
    // With no data, credentials defaults to [] so the empty state should show
    expect(screen.getByText('No credentials found')).toBeInTheDocument();
  });

  it('does not show Request Credential button in empty state when filter is not all', () => {
    const { useCredentials } = require('@/hooks/useCredentials');
    useCredentials.mockReturnValueOnce({
      data: { credentials: [{ id: '1', status: 'active', schemaType: 'KYC' }] },
      isLoading: false,
    });
    render(<CredentialsPage />);
    // Filter by 'revoked' — no results
    fireEvent.click(screen.getByText('Revoked'));
    expect(screen.getByText('No credentials found')).toBeInTheDocument();
    expect(screen.getByText('No revoked credentials')).toBeInTheDocument();
    // The "Request Credential" button should NOT appear in the empty state when filter !== 'all'
    // Only the header button should remain
    const reqButtons = screen.getAllByText('Request Credential');
    // The header button is always present — but the empty state button should not be
    expect(reqButtons.length).toBe(1); // only header button
  });
});
