import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CredentialList from '@/components/credentials/CredentialList';

jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock('lucide-react', () => ({
  Search: (props: any) => <div data-testid="icon-search" {...props} />,
  Filter: (props: any) => <div data-testid="icon-filter" {...props} />,
  Grid3X3: (props: any) => <div data-testid="icon-grid" {...props} />,
  List: (props: any) => <div data-testid="icon-list" {...props} />,
  ShieldCheck: (props: any) => <div data-testid="icon-shield-check" {...props} />,
  Clock: (props: any) => <div data-testid="icon-clock" {...props} />,
  ShieldAlert: (props: any) => <div data-testid="icon-shield-alert" {...props} />,
  AlertTriangle: (props: any) => <div data-testid="icon-alert" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  FolderOpen: (props: any) => <div data-testid="icon-folder-open" {...props} />,
}));

jest.mock('@/components/credentials/CredentialCard', () => {
  return function MockCredentialCard({ credential, onRevoke, onVerify }: any) {
    return (
      <div data-testid={`credential-card-${credential.id}`}>
        <span>{credential.name}</span>
        <button onClick={() => onRevoke(credential.id)}>Revoke</button>
        <button onClick={() => onVerify(credential.id)}>Verify</button>
      </div>
    );
  };
});

jest.mock('@/hooks/useCredentials', () => ({
  useCredentials: jest.fn(),
}));

import { useCredentials } from '@/hooks/useCredentials';
const mockUseCredentials = useCredentials as jest.Mock;

const mockCredentials = [
  { id: 'c1', name: 'KYC Credential', issuer: 'Aethelred', status: 'verified', schemaType: 'kyc' },
  { id: 'c2', name: 'Education Cert', issuer: 'University', status: 'pending', schemaType: 'education' },
  { id: 'c3', name: 'Employment Record', issuer: 'Company Inc', status: 'revoked', schemaType: 'employment' },
];

describe('CredentialList', () => {
  beforeEach(() => {
    mockUseCredentials.mockReturnValue({
      credentials: mockCredentials,
      isLoading: false,
      error: null,
      revokeCredential: jest.fn(),
      verifyCredential: jest.fn(),
    });
  });

  it('renders loading state', () => {
    mockUseCredentials.mockReturnValue({
      credentials: [],
      isLoading: true,
      error: null,
      revokeCredential: jest.fn(),
      verifyCredential: jest.fn(),
    });
    render(<CredentialList />);
    expect(screen.getByText('Loading credentials...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    mockUseCredentials.mockReturnValue({
      credentials: [],
      isLoading: false,
      error: new Error('Network error'),
      revokeCredential: jest.fn(),
      verifyCredential: jest.fn(),
    });
    render(<CredentialList />);
    expect(screen.getByText('Failed to load credentials: Network error')).toBeInTheDocument();
  });

  it('renders empty state when no credentials', () => {
    mockUseCredentials.mockReturnValue({
      credentials: [],
      isLoading: false,
      error: null,
      revokeCredential: jest.fn(),
      verifyCredential: jest.fn(),
    });
    render(<CredentialList />);
    expect(screen.getByText('No credentials yet. Request your first credential to get started.')).toBeInTheDocument();
  });

  it('renders credentials', () => {
    render(<CredentialList />);
    expect(screen.getByText('KYC Credential')).toBeInTheDocument();
    expect(screen.getByText('Education Cert')).toBeInTheDocument();
    expect(screen.getByText('Employment Record')).toBeInTheDocument();
  });

  it('shows credential count', () => {
    render(<CredentialList />);
    expect(screen.getByText('3 credentials found')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<CredentialList />);
    expect(screen.getByPlaceholderText('Search credentials...')).toBeInTheDocument();
  });

  it('filters credentials by search query', () => {
    render(<CredentialList />);
    const input = screen.getByPlaceholderText('Search credentials...');
    fireEvent.change(input, { target: { value: 'KYC' } });
    expect(screen.getByText('1 credential found')).toBeInTheDocument();
    expect(screen.getByText('KYC Credential')).toBeInTheDocument();
  });

  it('renders status filter tabs', () => {
    render(<CredentialList />);
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('filters by status when tab is clicked', () => {
    render(<CredentialList />);
    fireEvent.click(screen.getByText('Verified'));
    expect(screen.getByText('1 credential found')).toBeInTheDocument();
    expect(screen.getByText('KYC Credential')).toBeInTheDocument();
  });

  it('renders view mode toggle buttons', () => {
    render(<CredentialList />);
    expect(screen.getByLabelText('Grid view')).toBeInTheDocument();
    expect(screen.getByLabelText('List view')).toBeInTheDocument();
  });

  it('renders schema type dropdown', () => {
    render(<CredentialList />);
    const select = screen.getByDisplayValue('All Types');
    expect(select).toBeInTheDocument();
  });

  it('filters by schema type', () => {
    render(<CredentialList />);
    const select = screen.getByDisplayValue('All Types');
    fireEvent.change(select, { target: { value: 'kyc' } });
    expect(screen.getByText('1 credential found')).toBeInTheDocument();
  });

  it('shows no match message when filters exclude all', () => {
    render(<CredentialList />);
    fireEvent.click(screen.getByText('Expired'));
    expect(screen.getByText('No credentials match your filters.')).toBeInTheDocument();
  });

  it('switches to list view when list button is clicked', () => {
    render(<CredentialList />);
    fireEvent.click(screen.getByLabelText('List view'));
    // In list view, the container should have 'space-y-3' class (not grid)
    expect(screen.getByText('KYC Credential')).toBeInTheDocument();
  });

  it('switches back to grid view from list view', () => {
    render(<CredentialList />);
    fireEvent.click(screen.getByLabelText('List view'));
    fireEvent.click(screen.getByLabelText('Grid view'));
    expect(screen.getByText('KYC Credential')).toBeInTheDocument();
  });

  it('filters by search query matching issuer name', () => {
    render(<CredentialList />);
    const input = screen.getByPlaceholderText('Search credentials...');
    fireEvent.change(input, { target: { value: 'University' } });
    expect(screen.getByText('1 credential found')).toBeInTheDocument();
    expect(screen.getByText('Education Cert')).toBeInTheDocument();
  });

  it('filters by search query matching schema type', () => {
    render(<CredentialList />);
    const input = screen.getByPlaceholderText('Search credentials...');
    fireEvent.change(input, { target: { value: 'employment' } });
    expect(screen.getByText('1 credential found')).toBeInTheDocument();
    expect(screen.getByText('Employment Record')).toBeInTheDocument();
  });

  it('shows singular credential count for one result', () => {
    render(<CredentialList />);
    const input = screen.getByPlaceholderText('Search credentials...');
    fireEvent.change(input, { target: { value: 'KYC' } });
    expect(screen.getByText('1 credential found')).toBeInTheDocument();
  });

  it('handles null credentials from hook', () => {
    mockUseCredentials.mockReturnValue({
      credentials: null,
      isLoading: false,
      error: null,
      revokeCredential: jest.fn(),
      verifyCredential: jest.fn(),
    });
    render(<CredentialList />);
    expect(screen.getByText('0 credentials found')).toBeInTheDocument();
  });

  it('combines status and schema filters', () => {
    render(<CredentialList />);
    fireEvent.click(screen.getByText('Verified'));
    const select = screen.getByDisplayValue('All Types');
    fireEvent.change(select, { target: { value: 'kyc' } });
    expect(screen.getByText('1 credential found')).toBeInTheDocument();
  });

  it('combines search and status filters', () => {
    render(<CredentialList />);
    fireEvent.click(screen.getByText('Pending'));
    const input = screen.getByPlaceholderText('Search credentials...');
    fireEvent.change(input, { target: { value: 'Education' } });
    expect(screen.getByText('1 credential found')).toBeInTheDocument();
  });

  it('returns no results when search has no match', () => {
    render(<CredentialList />);
    const input = screen.getByPlaceholderText('Search credentials...');
    fireEvent.change(input, { target: { value: 'nonexistent-query-xyz' } });
    expect(screen.getByText('0 credentials found')).toBeInTheDocument();
  });
});
