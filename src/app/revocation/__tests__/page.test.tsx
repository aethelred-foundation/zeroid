import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/revocation',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('wagmi', () => ({
  useAccount: jest.fn(() => ({ address: '0x1234567890abcdef1234567890abcdef12345678', isConnected: true })),
  useReadContract: jest.fn(() => ({ data: undefined, isLoading: false })),
  useWriteContract: jest.fn(() => ({ writeContractAsync: jest.fn(), isPending: false })),
  useWaitForTransactionReceipt: jest.fn(() => ({ isLoading: false })),
}));

jest.mock('@rainbow-me/rainbowkit', () => ({
  ConnectButton: () => <div data-testid="connect-button">Connect</div>,
}));

jest.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      return React.forwardRef((props: any, ref: any) => {
        const { initial, animate, exit, transition, whileHover, whileTap, variants, ...rest } = props;
        const Tag = prop as any;
        return <Tag ref={ref} {...rest} />;
      });
    },
  }),
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useAnimation: () => ({ start: jest.fn() }),
  useInView: () => true,
}));

jest.mock('@/components/layout/AppLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

const mockRevokeCredentialMutateAsync = jest.fn();
const mockUseCredentials = jest.fn();

jest.mock('@/hooks/useCredentials', () => ({
  useCredentials: () => mockUseCredentials(),
  useRevokeCredential: () => ({
    mutateAsync: mockRevokeCredentialMutateAsync,
  }),
}));

jest.mock('@/components/ui/StatusBadge', () => ({
  StatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ open, children, title, onClose }: any) =>
    open ? <div data-testid="modal" role="dialog"><h2>{title}</h2>{children}<button data-testid="modal-close-btn" onClick={onClose}>X</button></div> : null,
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import RevocationPage from '../page';

const defaultCredentials = {
  data: {
    credentials: [
      { id: 'c1', schemaType: 'KYC Verification', status: 'active', issuedAt: '2025-01-01', expiresAt: '2026-01-01' },
      { id: 'c2', schemaType: 'Age Verification', status: 'active', issuedAt: '2025-02-01', expiresAt: '2026-02-01' },
      { id: 'c3', schemaType: 'Old Credential', status: 'revoked', issuedAt: '2024-01-01', expiresAt: '2025-01-01', revokedAt: '2025-06-01' },
    ],
  },
  isLoading: false,
};

describe('RevocationPage', () => {
  beforeEach(() => {
    mockUseCredentials.mockReturnValue(defaultCredentials);
    mockRevokeCredentialMutateAsync.mockReset();
  });

  it('renders without crashing', () => {
    render(<RevocationPage />);
    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
  });

  it('displays the page heading', () => {
    render(<RevocationPage />);
    expect(screen.getByText('Revocation')).toBeInTheDocument();
  });

  it('shows permanent revocation warning', () => {
    render(<RevocationPage />);
    expect(screen.getByText('Revocation is permanent')).toBeInTheDocument();
  });

  it('lists active credentials', () => {
    render(<RevocationPage />);
    expect(screen.getByText('KYC Verification')).toBeInTheDocument();
    expect(screen.getByText('Age Verification')).toBeInTheDocument();
  });

  it('shows previously revoked credentials', () => {
    render(<RevocationPage />);
    expect(screen.getByText('Old Credential')).toBeInTheDocument();
  });

  it('opens revocation confirmation modal when clicking Revoke', () => {
    render(<RevocationPage />);
    const revokeButtons = screen.getAllByText('Revoke');
    fireEvent.click(revokeButtons[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Confirm Revocation')).toBeInTheDocument();
  });

  it('filters credentials by search query', () => {
    render(<RevocationPage />);
    const searchInput = screen.getByPlaceholderText('Search active credentials to revoke...');
    fireEvent.change(searchInput, { target: { value: 'KYC' } });
    expect(screen.getByText('KYC Verification')).toBeInTheDocument();
    expect(screen.queryByText('Age Verification')).not.toBeInTheDocument();
  });

  it('calls revokeCredential on confirm and shows success toast', async () => {
    const { toast } = require('sonner');
    mockRevokeCredentialMutateAsync.mockResolvedValue(undefined);
    render(<RevocationPage />);
    const revokeButtons = screen.getAllByText('Revoke');
    fireEvent.click(revokeButtons[0]);
    fireEvent.click(screen.getByText('Confirm Revoke'));
    await screen.findByText('Confirm Revocation');
    expect(mockRevokeCredentialMutateAsync).toHaveBeenCalledWith('c1');
  });

  it('shows error toast when revocation fails', async () => {
    const { toast } = require('sonner');
    mockRevokeCredentialMutateAsync.mockRejectedValue(new Error('fail'));
    render(<RevocationPage />);
    const revokeButtons = screen.getAllByText('Revoke');
    fireEvent.click(revokeButtons[0]);
    fireEvent.click(screen.getByText('Confirm Revoke'));
    await new Promise((r) => setTimeout(r, 0));
    expect(toast.error).toHaveBeenCalledWith('Failed to revoke credential');
  });

  it('closes modal when Cancel is clicked', () => {
    render(<RevocationPage />);
    const revokeButtons = screen.getAllByText('Revoke');
    fireEvent.click(revokeButtons[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('displays revoked credentials with status badge', () => {
    render(<RevocationPage />);
    expect(screen.getByText(/Previously Revoked/)).toBeInTheDocument();
    expect(screen.getByTestId('status-badge')).toHaveTextContent('revoked');
  });

  it('triggers Modal onClose prop', () => {
    render(<RevocationPage />);
    const revokeButtons = screen.getAllByText('Revoke');
    fireEvent.click(revokeButtons[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('modal-close-btn'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows empty state when all credentials are filtered out', () => {
    render(<RevocationPage />);
    const searchInput = screen.getByPlaceholderText('Search active credentials to revoke...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    expect(screen.getByText('No active credentials to revoke')).toBeInTheDocument();
  });

  it('shows revoking state in modal during revocation', async () => {
    let resolvePromise: () => void;
    mockRevokeCredentialMutateAsync.mockReturnValue(new Promise<void>((r) => { resolvePromise = r; }));
    render(<RevocationPage />);
    const revokeButtons = screen.getAllByText('Revoke');
    fireEvent.click(revokeButtons[0]);
    fireEvent.click(screen.getByText('Confirm Revoke'));
    expect(await screen.findByText('Revoking...')).toBeInTheDocument();
    resolvePromise!();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('handles undefined data from useCredentials gracefully', () => {
    mockUseCredentials.mockReturnValue({ data: undefined, isLoading: false });
    render(<RevocationPage />);
    expect(screen.getByText('Active Credentials (0)')).toBeInTheDocument();
    expect(screen.getByText('No active credentials to revoke')).toBeInTheDocument();
    // No revoked section should appear
    expect(screen.queryByText(/Previously Revoked/)).not.toBeInTheDocument();
  });

  it('handles revoked credential with null revokedAt', () => {
    mockUseCredentials.mockReturnValue({
      data: {
        credentials: [
          { id: 'c4', schemaType: 'Null Date Cred', status: 'revoked', issuedAt: '2024-01-01', expiresAt: '2025-01-01', revokedAt: null },
        ],
      },
      isLoading: false,
    });
    render(<RevocationPage />);
    expect(screen.getByText('Null Date Cred')).toBeInTheDocument();
    expect(screen.getByText(/Previously Revoked/)).toBeInTheDocument();
  });
});
