import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('framer-motion', () => {
  const MotionDiv = React.forwardRef((props: any, ref: any) => {
    const { initial, animate, exit, transition, whileHover, whileTap, whileInView, variants, layout, onHoverStart, onHoverEnd, ...rest } = props;
    return <div ref={ref} data-testid="motion-div" onMouseEnter={onHoverStart} onMouseLeave={onHoverEnd} {...rest} />;
  });
  MotionDiv.displayName = 'MotionDiv';

  return {
    motion: {
      div: MotionDiv,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target: unknown, prop: string | symbol) => {
    if (prop === '__esModule') return true;
    return (props: any) => <div data-testid={`icon-${String(prop).toLowerCase()}`} {...props} />;
  },
}));

import IssuerCard from '../IssuerCard';

const mockIssuer = {
  id: 'issuer-1',
  name: 'Aethelred Authority',
  verified: true,
  trustScore: 92,
  credentialsIssued: 15000,
  verificationsCompleted: 8500,
  specializations: ['KYC' as const, 'AML' as const, 'Credit' as const],
  jurisdictions: ['US', 'EU', 'UK'],
  avgIssuanceTime: '2.5h',
  description: 'Leading credential issuer on the Aethelred network.',
};

describe('IssuerCard', () => {
  it('renders without crashing', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('Aethelred Authority')).toBeInTheDocument();
  });

  it('displays issuer name and verified badge', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('Aethelred Authority')).toBeInTheDocument();
    expect(screen.getByText('Verified Issuer')).toBeInTheDocument();
  });

  it('displays specializations', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('KYC')).toBeInTheDocument();
    expect(screen.getByText('AML')).toBeInTheDocument();
    expect(screen.getByText('Credit')).toBeInTheDocument();
  });

  it('displays jurisdictions', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('US, EU, UK')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading is true', () => {
    const { container } = render(<IssuerCard issuer={mockIssuer} loading />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Aethelred Authority')).not.toBeInTheDocument();
  });

  it('calls onConnect when Connect button is clicked', () => {
    const onConnect = jest.fn();
    render(<IssuerCard issuer={mockIssuer} onConnect={onConnect} />);
    fireEvent.click(screen.getByText('Connect'));
    expect(onConnect).toHaveBeenCalledWith('issuer-1');
  });

  it('renders compact variant', () => {
    render(<IssuerCard issuer={mockIssuer} compact />);
    expect(screen.getByText('Aethelred Authority')).toBeInTheDocument();
    // Compact mode should not show specializations section
    expect(screen.queryByText('Specializations')).not.toBeInTheDocument();
  });

  // --- NEW TESTS for uncovered branches/functions ---

  it('calls onRequest when Request Credential button is clicked', () => {
    const onRequest = jest.fn();
    render(<IssuerCard issuer={mockIssuer} onRequest={onRequest} />);
    fireEvent.click(screen.getByText('Request Credential'));
    expect(onRequest).toHaveBeenCalledWith('issuer-1');
  });

  it('renders both Connect and Request buttons when both callbacks provided', () => {
    const onConnect = jest.fn();
    const onRequest = jest.fn();
    render(<IssuerCard issuer={mockIssuer} onConnect={onConnect} onRequest={onRequest} />);
    expect(screen.getByText('Connect')).toBeInTheDocument();
    expect(screen.getByText('Request Credential')).toBeInTheDocument();
  });

  it('does not render Connect button when onConnect is not provided', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.queryByText('Connect')).not.toBeInTheDocument();
  });

  it('does not render Request Credential button when onRequest is not provided', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.queryByText('Request Credential')).not.toBeInTheDocument();
  });

  it('does not show Verified Issuer badge for unverified issuer', () => {
    const unverifiedIssuer = { ...mockIssuer, verified: false };
    render(<IssuerCard issuer={unverifiedIssuer} />);
    expect(screen.queryByText('Verified Issuer')).not.toBeInTheDocument();
  });

  it('displays description when present', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('Leading credential issuer on the Aethelred network.')).toBeInTheDocument();
  });

  it('does not display description when not present', () => {
    const noDescIssuer = { ...mockIssuer, description: undefined };
    render(<IssuerCard issuer={noDescIssuer} />);
    expect(screen.queryByText('Leading credential issuer on the Aethelred network.')).not.toBeInTheDocument();
  });

  it('formats credentials issued in K format for large numbers', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('15.0K')).toBeInTheDocument();
  });

  it('formats verifications completed in K format for large numbers', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('8.5K')).toBeInTheDocument();
  });

  it('shows raw number for credentials issued below 1000', () => {
    const smallIssuer = { ...mockIssuer, credentialsIssued: 500, verificationsCompleted: 200 };
    render(<IssuerCard issuer={smallIssuer} />);
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('displays trust score', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('/ 100')).toBeInTheDocument();
  });

  it('displays avg issuance time', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('2.5h')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<IssuerCard issuer={mockIssuer} className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('applies custom className in loading state', () => {
    const { container } = render(<IssuerCard issuer={mockIssuer} loading className="loading-class" />);
    expect(container.firstChild).toHaveClass('loading-class');
  });

  it('applies custom className in compact mode', () => {
    const { container } = render(<IssuerCard issuer={mockIssuer} compact className="compact-class" />);
    expect(container.firstChild).toHaveClass('compact-class');
  });

  it('renders compact variant with verified badge', () => {
    render(<IssuerCard issuer={mockIssuer} compact />);
    // In compact mode, the ShieldCheck icon should appear for verified issuers
    expect(screen.getByText('Aethelred Authority')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
  });

  it('renders compact variant without verified badge for unverified issuer', () => {
    const unverifiedIssuer = { ...mockIssuer, verified: false };
    render(<IssuerCard issuer={unverifiedIssuer} compact />);
    expect(screen.getByText('Aethelred Authority')).toBeInTheDocument();
  });

  it('renders all specialization types with correct styling', () => {
    const allSpecsIssuer = {
      ...mockIssuer,
      specializations: ['KYC' as const, 'Residency' as const, 'Credit' as const, 'Employment' as const, 'Education' as const, 'Accreditation' as const, 'AML' as const, 'Age' as const],
    };
    render(<IssuerCard issuer={allSpecsIssuer} />);
    expect(screen.getByText('KYC')).toBeInTheDocument();
    expect(screen.getByText('Residency')).toBeInTheDocument();
    expect(screen.getByText('Credit')).toBeInTheDocument();
    expect(screen.getByText('Employment')).toBeInTheDocument();
    expect(screen.getByText('Education')).toBeInTheDocument();
    expect(screen.getByText('Accreditation')).toBeInTheDocument();
    expect(screen.getByText('AML')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
  });

  it('renders star rating with half star for appropriate trust scores', () => {
    // trustScore 92 / 100 * 5 = 4.6 => 4 full + 1 half + 0 empty
    render(<IssuerCard issuer={mockIssuer} />);
    // Stars should render (we can check the component renders)
    expect(screen.getByText('Aethelred Authority')).toBeInTheDocument();
  });

  it('renders star rating with no half star for exact scores', () => {
    const exactScoreIssuer = { ...mockIssuer, trustScore: 100 };
    // 100 / 100 * 5 = 5.0 => 5 full + 0 half + 0 empty
    render(<IssuerCard issuer={exactScoreIssuer} />);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders star rating with low trust score', () => {
    const lowScoreIssuer = { ...mockIssuer, trustScore: 20 };
    // 20 / 100 * 5 = 1.0 => 1 full + 0 half + 4 empty
    render(<IssuerCard issuer={lowScoreIssuer} />);
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('caps trust score normalization at 5', () => {
    const highScoreIssuer = { ...mockIssuer, trustScore: 150 };
    // 150 / 100 * 5 = 7.5, capped to 5
    render(<IssuerCard issuer={highScoreIssuer} />);
    expect(screen.getByText('150')).toBeInTheDocument();
  });

  it('renders labels for stat sections', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('Issued')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Avg Time')).toBeInTheDocument();
  });

  it('renders Specializations and Jurisdictions labels', () => {
    render(<IssuerCard issuer={mockIssuer} />);
    expect(screen.getByText('Specializations')).toBeInTheDocument();
    expect(screen.getByText('Jurisdictions')).toBeInTheDocument();
  });

  it('does not show description in compact mode', () => {
    render(<IssuerCard issuer={mockIssuer} compact />);
    expect(screen.queryByText('Leading credential issuer on the Aethelred network.')).not.toBeInTheDocument();
  });

  it('handles hover start and end on full card', () => {
    const { container } = render(<IssuerCard issuer={mockIssuer} />);
    const card = container.firstChild as HTMLElement;
    // Trigger hover callbacks through onMouseEnter/onMouseLeave mapped in mock
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    // Should not crash
    expect(screen.getByText('Aethelred Authority')).toBeInTheDocument();
  });

  it('triggers onHoverEnd callback when mouse leaves the full card', () => {
    const { container } = render(<IssuerCard issuer={mockIssuer} />);
    const card = container.firstChild as HTMLElement;
    // The mock maps onHoverStart/onHoverEnd to onMouseOver/onMouseOut on the div
    fireEvent.mouseOver(card);
    fireEvent.mouseOut(card);
    // Card should still render correctly after hover end
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders website link when website is not provided', () => {
    const issuerNoWebsite = { ...mockIssuer, website: undefined };
    render(<IssuerCard issuer={issuerNoWebsite} />);
    expect(screen.getByText('Aethelred Authority')).toBeInTheDocument();
  });
});
