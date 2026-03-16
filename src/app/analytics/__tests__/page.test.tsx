import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/analytics',
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

import AnalyticsPage from '../page';

describe('AnalyticsPage', () => {
  it('renders without crashing', () => {
    render(<AnalyticsPage />);
    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
  });

  it('displays the page heading', () => {
    render(<AnalyticsPage />);
    expect(screen.getByText('Privacy-Preserving Analytics')).toBeInTheDocument();
  });

  it('shows Credential Usage tab by default', () => {
    render(<AnalyticsPage />);
    expect(screen.getByText('Verifications Over Time')).toBeInTheDocument();
    expect(screen.getByText('Verifier Analytics')).toBeInTheDocument();
  });

  it('switches time range', () => {
    render(<AnalyticsPage />);
    const button7d = screen.getByRole('button', { name: '7d' });
    fireEvent.click(button7d);
    expect(button7d).toBeInTheDocument();
  });

  it('switches to Privacy Analysis tab', () => {
    render(<AnalyticsPage />);
    const privacyTab = screen.getByRole('button', { name: /Privacy Analysis/i });
    fireEvent.click(privacyTab);
    expect(screen.getAllByText('Privacy Score').length).toBeGreaterThan(0);
    expect(screen.getByText('Disclosure Breakdown')).toBeInTheDocument();
  });

  it('shows privacy analysis details', () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Privacy Analysis/i }));
    // Check disclosure breakdown
    expect(screen.getByText('ZK Proved')).toBeInTheDocument();
    expect(screen.getByText('Selective')).toBeInTheDocument();
    expect(screen.getAllByText('Full Disclosure').length).toBeGreaterThan(0);
    // Data exposure timeline
    expect(screen.getByText('Data Exposure Timeline')).toBeInTheDocument();
    // Privacy recommendations
    expect(screen.getByText('Privacy Recommendations')).toBeInTheDocument();
    expect(screen.getByText('Bridge credentials to Solana')).toBeInTheDocument();
  });

  it('switches to Identity Health tab', () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Identity Health/i }));
    expect(screen.getByText('Identity Health Metrics')).toBeInTheDocument();
    expect(screen.getByText('Credential Freshness')).toBeInTheDocument();
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.getByText('Diversification')).toBeInTheDocument();
    expect(screen.getByText('Verification Readiness')).toBeInTheDocument();
    expect(screen.getByText('Cross-Chain Coverage')).toBeInTheDocument();
    // Overall scores
    expect(screen.getByText('Overall Health')).toBeInTheDocument();
    expect(screen.getByText('Active Credentials')).toBeInTheDocument();
    expect(screen.getByText('Issuers')).toBeInTheDocument();
  });

  it('switches to Network Analytics tab', () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Network Analytics/i }));
    // Network stats cards
    expect(screen.getAllByText('Total Credentials').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total Verifications').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unique Users').length).toBeGreaterThan(0);
    expect(screen.getByText('Network Growth')).toBeInTheDocument();
    // Benchmarks section
    expect(screen.getByText(/Anonymized Benchmarks/)).toBeInTheDocument();
    expect(screen.getByText('Credential Coverage')).toBeInTheDocument();
    expect(screen.getByText('ZK Proof Usage')).toBeInTheDocument();
    expect(screen.getByText('Verification Speed')).toBeInTheDocument();
    expect(screen.getByText('Cross-Chain Presence')).toBeInTheDocument();
  });

  it('switches between all time ranges', () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: '90d' }));
    expect(screen.getByRole('button', { name: '90d' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1y' }));
    expect(screen.getByRole('button', { name: '1y' })).toBeInTheDocument();
  });

  it('shows exposure timeline with different methods', () => {
    render(<AnalyticsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Privacy Analysis/i }));
    // Verify different disclosure methods are shown
    expect(screen.getAllByText('ZK Proof').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Selective Disclosure').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Full Disclosure').length).toBeGreaterThan(0);
  });

  it('shows verifier analytics table in usage tab', () => {
    render(<AnalyticsPage />);
    expect(screen.getByText('Aethelred DeFi Protocol')).toBeInTheDocument();
    expect(screen.getByText('NoblePay Gateway')).toBeInTheDocument();
    expect(screen.getByText('Cruzible Exchange')).toBeInTheDocument();
  });

  it('shows credential type breakdown in usage tab', () => {
    render(<AnalyticsPage />);
    expect(screen.getByText('By Credential Type')).toBeInTheDocument();
    expect(screen.getAllByText('KYC Identity').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Age Verification').length).toBeGreaterThan(0);
  });
});
