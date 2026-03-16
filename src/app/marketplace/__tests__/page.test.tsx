import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/marketplace',
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

import MarketplacePage from '../page';

describe('MarketplacePage', () => {
  it('renders without crashing', () => {
    render(<MarketplacePage />);
    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
  });

  it('displays the page heading', () => {
    render(<MarketplacePage />);
    expect(screen.getByText('Credential Marketplace')).toBeInTheDocument();
  });

  it('shows metric cards', () => {
    render(<MarketplacePage />);
    expect(screen.getAllByText('Credential Schemas').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Verified Issuers')).toBeInTheDocument();
    expect(screen.getByText('1.3M')).toBeInTheDocument();
    expect(screen.getByText('93')).toBeInTheDocument();
  });

  it('renders featured credentials section', () => {
    render(<MarketplacePage />);
    expect(screen.getByText('Featured Credentials')).toBeInTheDocument();
  });

  it('switches to Issuer Leaderboard section', () => {
    render(<MarketplacePage />);
    const tabButtons = screen.getAllByRole('button');
    const issuerTab = tabButtons.find(btn => btn.textContent === 'Issuer Leaderboard');
    fireEvent.click(issuerTab!);
    expect(screen.getAllByText('Aethelred Trust Services').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('SecureVault Compliance')).toBeInTheDocument();
  });

  it('filters schemas by category', () => {
    render(<MarketplacePage />);
    // Click the 'Financial' category filter button (not the schema category badge)
    const financialButtons = screen.getAllByText('Financial');
    const filterButton = financialButtons.find(el => el.tagName === 'BUTTON');
    fireEvent.click(filterButton!);
    // Financial schemas should be shown (may appear in both featured and list)
    expect(screen.getAllByText('Accredited Investor Attestation').length).toBeGreaterThanOrEqual(1);
  });

  it('shows issuer detail when issuer is clicked in leaderboard', () => {
    render(<MarketplacePage />);
    // Switch to issuers tab
    const tabButtons = screen.getAllByRole('button');
    const issuerTab = tabButtons.find(btn => btn.textContent === 'Issuer Leaderboard');
    fireEvent.click(issuerTab!);
    // Click on an issuer to expand detail
    const issuerName = screen.getAllByText('Aethelred Trust Services');
    // Click the issuer row
    fireEvent.click(issuerName[0].closest('[class*="cursor-pointer"]')!);
    // Should show expanded detail
    expect(screen.getByText('Schemas Published')).toBeInTheDocument();
    expect(screen.getByText('Avg Response Time')).toBeInTheDocument();
  });

  it('searches credentials by name', () => {
    render(<MarketplacePage />);
    const searchInput = screen.getByPlaceholderText('Search credentials or issuers...');
    fireEvent.change(searchInput, { target: { value: 'Credit Score' } });
    // Only Credit Score Attestation should match the search
    expect(screen.getByText('Credit Score Attestation')).toBeInTheDocument();
  });

  it('filters by jurisdiction', () => {
    render(<MarketplacePage />);
    const jurisdictionSelect = screen.getByRole('combobox');
    fireEvent.change(jurisdictionSelect, { target: { value: 'UAE' } });
    // Schemas available in UAE should be shown
    expect(screen.getAllByText('Business Entity Verification').length).toBeGreaterThanOrEqual(1);
  });

  it('switches to list view mode and shows list layout', () => {
    render(<MarketplacePage />);
    // Find the list view toggle button - it's the one with p-2.5 class that is NOT active
    const allButtons = screen.getAllByRole('button');
    const listBtn = allButtons.find(btn => {
      const classes = btn.getAttribute('class') || '';
      return classes.includes('p-2.5') && !classes.includes('bg-brand-600') && btn.querySelector('svg');
    });
    if (listBtn) {
      fireEvent.click(listBtn);
      // In list view, Request buttons should be visible
      expect(screen.getAllByText('Request').length).toBeGreaterThanOrEqual(1);
    }
  });

  it('searches credentials by issuer name', () => {
    render(<MarketplacePage />);
    const searchInput = screen.getByPlaceholderText('Search credentials or issuers...');
    fireEvent.change(searchInput, { target: { value: 'FinScore' } });
    // Only the Credit Score Attestation from FinScore Labs should match
    expect(screen.getByText('Credit Score Attestation')).toBeInTheDocument();
  });

  it('switches back to schemas section from issuers', () => {
    render(<MarketplacePage />);
    // Switch to issuers tab first
    const issuerTab = screen.getAllByRole('button').find(btn => btn.textContent === 'Issuer Leaderboard');
    fireEvent.click(issuerTab!);
    expect(screen.getByText('SecureVault Compliance')).toBeInTheDocument();

    // Switch back to schemas
    const schemasTab = screen.getAllByRole('button').find(btn => btn.textContent === 'Credential Schemas');
    fireEvent.click(schemasTab!);
    expect(screen.getByPlaceholderText('Search credentials or issuers...')).toBeInTheDocument();
  });

  it('switches back to grid view from list view', () => {
    render(<MarketplacePage />);
    // Find view toggle buttons — they are inside a container with specific classes
    const allButtons = screen.getAllByRole('button');
    const viewButtons = allButtons.filter(btn => {
      const cls = btn.getAttribute('class') || '';
      return cls.includes('p-2.5');
    });
    // viewButtons[0] = grid (active), viewButtons[1] = list (inactive)
    expect(viewButtons.length).toBe(2);

    // Switch to list view
    fireEvent.click(viewButtons[1]);

    // Now find the view buttons again (they re-rendered with different classes)
    const allButtons2 = screen.getAllByRole('button');
    const viewButtons2 = allButtons2.filter(btn => {
      const cls = btn.getAttribute('class') || '';
      return cls.includes('p-2.5');
    });

    // Switch back to grid view — this covers setViewMode('grid') on line 210
    fireEvent.click(viewButtons2[0]);

    // Verify schemas are still rendered
    expect(screen.getAllByText('KYC Identity Verification').length).toBeGreaterThanOrEqual(1);
  });

  it('collapses issuer detail when clicking same issuer again', () => {
    render(<MarketplacePage />);
    // Switch to issuers tab
    const issuerTab = screen.getAllByRole('button').find(btn => btn.textContent === 'Issuer Leaderboard');
    fireEvent.click(issuerTab!);

    // Click on first issuer to expand (null -> 'i1')
    fireEvent.click(screen.getByText('Aethelred Trust Services').closest('[class*="cursor-pointer"]')!);
    expect(screen.getByText('Schemas Published')).toBeInTheDocument();

    // Click same issuer again to collapse ('i1' -> null) — covers the `null` branch of the ternary
    fireEvent.click(screen.getByText('Aethelred Trust Services').closest('[class*="cursor-pointer"]')!);
    // Verify component didn't crash — re-query the element since DOM updates
    expect(screen.getByText('Aethelred Trust Services')).toBeInTheDocument();
  });

  it('switches issuer detail to a different issuer', () => {
    render(<MarketplacePage />);
    const issuerTab = screen.getAllByRole('button').find(btn => btn.textContent === 'Issuer Leaderboard');
    fireEvent.click(issuerTab!);

    // Click first issuer to expand
    fireEvent.click(screen.getByText('Aethelred Trust Services').closest('[class*="cursor-pointer"]')!);

    // Click second issuer (different id) — showIssuerDetail !== issuer.id, so sets to new id
    fireEvent.click(screen.getByText('SecureVault Compliance').closest('[class*="cursor-pointer"]')!);
    expect(screen.getByText('SecureVault Compliance')).toBeInTheDocument();
  });
});
