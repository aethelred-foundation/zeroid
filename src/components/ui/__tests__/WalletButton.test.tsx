import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock lucide-react
jest.mock('lucide-react', () => ({
  Wallet: (props: Record<string, unknown>) => <span data-testid="icon-wallet" {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="icon-chevron-down" {...props} />,
  BadgeCheck: (props: Record<string, unknown>) => <span data-testid="icon-badge-check" {...props} />,
  AlertCircle: (props: Record<string, unknown>) => <span data-testid="icon-alert-circle" {...props} />,
}));

// Type for the ConnectButton.Custom render prop
interface RenderProps {
  account?: {
    displayName: string;
    displayBalance?: string;
  };
  chain?: {
    unsupported?: boolean;
    hasIcon?: boolean;
    iconUrl?: string;
    name?: string;
  };
  openAccountModal: () => void;
  openChainModal: () => void;
  openConnectModal: () => void;
  authenticationStatus?: string;
  mounted: boolean;
}

// Default mock state holder
let mockState: Partial<RenderProps> = {};

// Mock RainbowKit ConnectButton - calls children with mockState
jest.mock('@rainbow-me/rainbowkit', () => ({
  ConnectButton: {
    Custom: ({ children }: { children: (props: RenderProps) => React.ReactNode }) => {
      const defaultState: RenderProps = {
        account: undefined,
        chain: undefined,
        openAccountModal: jest.fn(),
        openChainModal: jest.fn(),
        openConnectModal: jest.fn(),
        authenticationStatus: undefined,
        mounted: false,
      };
      return <>{children({ ...defaultState, ...mockState })}</>;
    },
  },
}));

import { WalletButton } from '@/components/ui/WalletButton';

describe('WalletButton', () => {
  beforeEach(() => {
    mockState = {};
  });

  it('renders loading skeleton when not ready (not mounted)', () => {
    mockState = { mounted: false };
    const { container } = render(<WalletButton />);
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('renders loading skeleton when authentication is loading', () => {
    mockState = { mounted: true, authenticationStatus: 'loading' };
    const { container } = render(<WalletButton />);
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('renders Connect button when not connected', () => {
    const openConnectModal = jest.fn();
    mockState = { mounted: true, openConnectModal };
    render(<WalletButton />);
    const connectBtn = screen.getByText('Connect');
    expect(connectBtn).toBeInTheDocument();
    fireEvent.click(connectBtn);
    expect(openConnectModal).toHaveBeenCalled();
  });

  it('renders account info when connected with chain icon', () => {
    const openAccountModal = jest.fn();
    const openChainModal = jest.fn();
    mockState = {
      account: { displayName: '0x1234...5678', displayBalance: '1.5 ETH' },
      chain: { unsupported: false, hasIcon: true, iconUrl: '/chain.png', name: 'Aethelred' },
      openAccountModal,
      openChainModal,
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByText('0x1234...5678')).toBeInTheDocument();
    expect(screen.getByText('Aethelred')).toBeInTheDocument();
    expect(screen.getByText('1.5 ETH')).toBeInTheDocument();
    // Chain icon should be rendered
    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('/chain.png');
  });

  it('shows Wrong Network when chain is unsupported', () => {
    mockState = {
      account: { displayName: '0xabcd...efgh' },
      chain: { unsupported: true, name: 'Wrong' },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByText('Wrong Network')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    mockState = { mounted: false };
    const { container } = render(<WalletButton className="custom-wallet" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('custom-wallet');
  });

  it('renders connected state without chain icon when hasIcon is false', () => {
    mockState = {
      account: { displayName: '0x1234...5678', displayBalance: '1.0 ETH' },
      chain: { unsupported: false, hasIcon: false, iconUrl: undefined, name: 'TestChain' },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByText('TestChain')).toBeInTheDocument();
    const imgs = document.querySelectorAll('img');
    expect(imgs.length).toBe(0);
  });

  it('renders connected state without displayBalance', () => {
    mockState = {
      account: { displayName: '0xnobalance' },
      chain: { unsupported: false, hasIcon: true, iconUrl: '/icon.png', name: 'Net' },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByText('0xnobalance')).toBeInTheDocument();
    expect(screen.queryByText(/ETH/)).toBeNull();
  });

  it('does not render chain icon when hasIcon is true but iconUrl is undefined (line 93)', () => {
    mockState = {
      account: { displayName: '0xtest2' },
      chain: { unsupported: false, hasIcon: true, iconUrl: undefined, name: 'NoIcon' },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByText('NoIcon')).toBeInTheDocument();
    const imgs = document.querySelectorAll('img');
    expect(imgs.length).toBe(0);
  });

  it('does not render chain icon when hasIcon is true but iconUrl is empty string', () => {
    mockState = {
      account: { displayName: '0xtest3' },
      chain: { unsupported: false, hasIcon: true, iconUrl: '', name: 'EmptyUrl' },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByText('EmptyUrl')).toBeInTheDocument();
    const imgs = document.querySelectorAll('img');
    expect(imgs.length).toBe(0);
  });

  it('does not render chain icon when hasIcon is false and iconUrl is provided', () => {
    mockState = {
      account: { displayName: '0xtest4' },
      chain: { unsupported: false, hasIcon: false, iconUrl: '/some-icon.png', name: 'NoHasIcon' },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByText('NoHasIcon')).toBeInTheDocument();
    const imgs = document.querySelectorAll('img');
    expect(imgs.length).toBe(0);
  });

  it('renders verification badge with unverified level when chain is unsupported', () => {
    mockState = {
      account: { displayName: '0xbadge' },
      chain: { unsupported: true, name: 'BadChain' },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByTestId('icon-alert-circle')).toBeInTheDocument();
  });

  it('renders verification badge with verified level when chain is supported', () => {
    mockState = {
      account: { displayName: '0xverified' },
      chain: { unsupported: false, name: 'GoodChain' },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    expect(screen.getByTestId('icon-badge-check')).toBeInTheDocument();
  });

  it('calls openChainModal when chain button is clicked (supported)', () => {
    const openChainModal = jest.fn();
    mockState = {
      account: { displayName: '0xchain' },
      chain: { unsupported: false, hasIcon: false, name: 'ClickChain' },
      openAccountModal: jest.fn(),
      openChainModal,
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    fireEvent.click(screen.getByText('ClickChain'));
    expect(openChainModal).toHaveBeenCalled();
  });

  it('calls openAccountModal when account button is clicked', () => {
    const openAccountModal = jest.fn();
    mockState = {
      account: { displayName: '0xaccount' },
      chain: { unsupported: false, name: 'Chain1' },
      openAccountModal,
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    fireEvent.click(screen.getByText('0xaccount'));
    expect(openAccountModal).toHaveBeenCalled();
  });

  it('calls openChainModal when Wrong Network button is clicked', () => {
    const openChainModal = jest.fn();
    mockState = {
      account: { displayName: '0xwrong' },
      chain: { unsupported: true, name: 'BadNet' },
      openAccountModal: jest.fn(),
      openChainModal,
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    fireEvent.click(screen.getByText('Wrong Network'));
    expect(openChainModal).toHaveBeenCalled();
  });

  it('renders with chain.name undefined (falls back to "Chain" in alt)', () => {
    mockState = {
      account: { displayName: '0xnoname' },
      chain: { unsupported: false, hasIcon: true, iconUrl: '/icon.png', name: undefined },
      openAccountModal: jest.fn(),
      openChainModal: jest.fn(),
      openConnectModal: jest.fn(),
      authenticationStatus: 'authenticated',
      mounted: true,
    };
    render(<WalletButton />);
    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('alt')).toBe('Chain');
  });
});
