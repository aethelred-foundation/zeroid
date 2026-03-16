import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/integrations',
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

import IntegrationsPage from '../page';

describe('IntegrationsPage', () => {
  it('renders without crashing', () => {
    render(<IntegrationsPage />);
    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
  });

  it('displays the page heading', () => {
    render(<IntegrationsPage />);
    expect(screen.getByText('Integrations')).toBeInTheDocument();
  });

  it('shows stats bar', () => {
    render(<IntegrationsPage />);
    expect(screen.getByText('Connected dApps')).toBeInTheDocument();
    expect(screen.getByText('Total Verifications')).toBeInTheDocument();
    expect(screen.getByText('Available Integrations')).toBeInTheDocument();
  });

  it('renders integration cards', () => {
    render(<IntegrationsPage />);
    expect(screen.getByText('Cruzible')).toBeInTheDocument();
    expect(screen.getByText('NoblePay')).toBeInTheDocument();
    expect(screen.getByText('Shiora')).toBeInTheDocument();
  });

  it('filters integrations by search query', () => {
    render(<IntegrationsPage />);
    const searchInput = screen.getByPlaceholderText('Search integrations...');
    fireEvent.change(searchInput, { target: { value: 'Noble' } });
    expect(screen.getByText('NoblePay')).toBeInTheDocument();
    expect(screen.queryByText('Cruzible')).not.toBeInTheDocument();
  });

  it('filters integrations by category', () => {
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByText('defi'));
    expect(screen.getByText('Cruzible')).toBeInTheDocument();
    expect(screen.queryByText('NoblePay')).not.toBeInTheDocument();
  });
});
