import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import VerificationFlow from '@/components/verification/VerificationFlow';

jest.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      return ({ children, initial, animate, exit, transition, whileHover, whileTap, variants, layout, ...rest }: any) => {
        const Tag = prop as any;
        return <Tag {...rest}>{children}</Tag>;
      };
    },
  }),
  AnimatePresence: ({ children }: any) => children,
}));

jest.mock('lucide-react', () => ({
  ShieldCheck: (props: any) => <div data-testid="icon-shield-check" {...props} />,
  ArrowRight: (props: any) => <div data-testid="icon-arrow-right" {...props} />,
  ArrowLeft: (props: any) => <div data-testid="icon-arrow-left" {...props} />,
  Loader2: (props: any) => <div data-testid="icon-loader" {...props} />,
  CheckCircle2: (props: any) => <div data-testid="icon-check" {...props} />,
  XCircle: (props: any) => <div data-testid="icon-x-circle" {...props} />,
  AlertCircle: (props: any) => <div data-testid="icon-alert" {...props} />,
  Fingerprint: (props: any) => <div data-testid="icon-fingerprint" {...props} />,
  Eye: (props: any) => <div data-testid="icon-eye" {...props} />,
  EyeOff: (props: any) => <div data-testid="icon-eye-off" {...props} />,
  Zap: (props: any) => <div data-testid="icon-zap" {...props} />,
  Lock: (props: any) => <div data-testid="icon-lock" {...props} />,
  Send: (props: any) => <div data-testid="icon-send" {...props} />,
  RotateCcw: (props: any) => <div data-testid="icon-rotate" {...props} />,
  Sparkles: (props: any) => <div data-testid="icon-sparkles" {...props} />,
}));

jest.mock('@/components/verification/SelectiveDisclosureBuilder', () => {
  const MockSelectiveDisclosureBuilder = ({ onComplete }: any) => (
    <div data-testid="selective-disclosure-builder">
      <button onClick={() => onComplete({ disclosed: [], zkProved: [], hidden: [] })}>
        Mock Complete Selection
      </button>
    </div>
  );
  return {
    __esModule: true,
    default: MockSelectiveDisclosureBuilder,
  };
});

jest.mock('@/components/zkp/ProofGenerator', () => {
  const MockProofGenerator = ({ onProofGenerated }: any) => (
    <div data-testid="proof-generator">
      <button onClick={() => onProofGenerated({ hash: '0xproof123', protocol: 'Groth16', curve: 'BN254' })}>
        Mock Generate Proof
      </button>
    </div>
  );
  return {
    __esModule: true,
    default: MockProofGenerator,
  };
});

jest.mock('@/hooks/useVerification', () => ({
  useVerification: () => ({
    submitProof: jest.fn().mockResolvedValue({ verified: true, transactionHash: '0xtx123' }),
    isVerifying: false,
  }),
}));

jest.mock('@/hooks/useProof', () => ({
  useProof: () => ({
    generateProof: jest.fn(),
    proofStatus: 'idle',
  }),
}));

const mockRequest = {
  id: 'req-123',
  verifierName: 'Test Verifier',
  requestedAttributes: [
    { key: 'fullName', value: 'John Doe', type: 'string' },
  ],
};

describe('VerificationFlow', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('renders header', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    expect(screen.getByText('Identity Verification')).toBeInTheDocument();
    expect(screen.getByText('Requested by Test Verifier')).toBeInTheDocument();
  });

  it('renders default subtitle when no request', () => {
    render(<VerificationFlow />);
    expect(screen.getByText('Generate a zero-knowledge proof of your credentials')).toBeInTheDocument();
  });

  it('renders step progress labels', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    expect(screen.getByText('Select Attributes')).toBeInTheDocument();
    expect(screen.getByText('Generate Proof')).toBeInTheDocument();
    expect(screen.getByText('Submit')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
  });

  it('renders step counter', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
  });

  it('renders SelectiveDisclosureBuilder on first step', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    expect(screen.getByTestId('selective-disclosure-builder')).toBeInTheDocument();
  });

  it('advances to proof generation step', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    expect(screen.getByTestId('proof-generator')).toBeInTheDocument();
  });

  it('advances to submit step after proof generation', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    expect(screen.getByText('Proof Summary')).toBeInTheDocument();
    expect(screen.getByText('Submit Proof')).toBeInTheDocument();
  });

  it('renders cancel button on first step', () => {
    const onCancel = jest.fn();
    render(<VerificationFlow request={mockRequest as any} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders back button on subsequent steps', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('goes back when back is clicked', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByTestId('selective-disclosure-builder')).toBeInTheDocument();
  });

  it('submits proof and shows success result', async () => {
    const onComplete = jest.fn();
    render(<VerificationFlow request={mockRequest as any} onComplete={onComplete} />);

    // Step 1: Complete disclosure selection
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    // Step 2: Generate proof
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    // Step 3: Submit proof
    expect(screen.getByText('Submit Proof')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    // Step 4: Should show success result
    expect(screen.getByText('Verification Successful')).toBeInTheDocument();
    expect(screen.getByText(/zero-knowledge proof has been verified/)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ verified: true }));
  });

  it('shows transaction hash in result when available', async () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });
    expect(screen.getByText('Transaction Hash')).toBeInTheDocument();
    expect(screen.getByText('0xtx123')).toBeInTheDocument();
  });

  it('shows verification failed result', async () => {
    jest.spyOn(require('@/hooks/useVerification'), 'useVerification').mockReturnValue({
      submitProof: jest.fn().mockResolvedValue({ verified: false, reason: 'Invalid proof' }),
      isVerifying: false,
    });

    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    expect(screen.getByText('Verification Failed')).toBeInTheDocument();
    expect(screen.getByText('Invalid proof')).toBeInTheDocument();
  });

  it('shows default failure message when no reason provided', async () => {
    jest.spyOn(require('@/hooks/useVerification'), 'useVerification').mockReturnValue({
      submitProof: jest.fn().mockResolvedValue({ verified: false }),
      isVerifying: false,
    });

    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    expect(screen.getByText('Verification Failed')).toBeInTheDocument();
    expect(screen.getByText(/could not be verified/)).toBeInTheDocument();
  });

  it('shows error when proof submission fails', async () => {
    jest.spyOn(require('@/hooks/useVerification'), 'useVerification').mockReturnValue({
      submitProof: jest.fn().mockRejectedValue(new Error('Network error')),
      isVerifying: false,
    });

    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('shows generic error for non-Error throw', async () => {
    jest.spyOn(require('@/hooks/useVerification'), 'useVerification').mockReturnValue({
      submitProof: jest.fn().mockRejectedValue('string error'),
      isVerifying: false,
    });

    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    expect(screen.getByText('Proof submission failed')).toBeInTheDocument();
  });

  it('does not submit when proof or request is missing', async () => {
    const submitProof = jest.fn();
    jest.spyOn(require('@/hooks/useVerification'), 'useVerification').mockReturnValue({
      submitProof,
      isVerifying: false,
    });

    // Render without request
    render(<VerificationFlow />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    expect(submitProof).not.toHaveBeenCalled();
  });

  it('resets flow when Start Over is clicked', async () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    // Should be on result step, click Start Over
    fireEvent.click(screen.getByText('Start Over'));
    // Should return to first step
    expect(screen.getByTestId('selective-disclosure-builder')).toBeInTheDocument();
  });

  it('shows Close button in result step when onCancel is provided', async () => {
    const onCancel = jest.fn();
    render(<VerificationFlow request={mockRequest as any} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    fireEvent.click(screen.getByText('Close'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not show Close button in result when onCancel is not provided', async () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    expect(screen.queryByText('Close')).not.toBeInTheDocument();
  });

  it('does not show navigation footer on result step', async () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    // Navigation with step counter should be hidden on result step
    expect(screen.queryByText('Step 4 of 4')).not.toBeInTheDocument();
  });

  it('shows proof hash on submit step', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    expect(screen.getByText('Proof Hash')).toBeInTheDocument();
    expect(screen.getByText('0xproof123')).toBeInTheDocument();
  });

  it('shows "No attributes directly disclosed" when none are disclosed', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    expect(screen.getByText('No attributes directly disclosed')).toBeInTheDocument();
  });

  it('shows disclosed attributes on submit step', () => {
    // Override mock to return disclosed attributes
    jest.spyOn(
      require('@/components/verification/SelectiveDisclosureBuilder'),
      'default'
    ).mockImplementation(({ onComplete }: any) => (
      <div data-testid="selective-disclosure-builder">
        <button
          onClick={() =>
            onComplete({
              disclosed: [{ key: 'fullName', value: 'John Doe' }],
              zkProved: [{ key: 'age', value: '30' }],
              hidden: [],
            })
          }
        >
          Mock Complete Selection
        </button>
      </div>
    ));

    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    expect(screen.getByText('fullName:')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    // ZK-proved attributes show masked values
    expect(screen.getByText('age:')).toBeInTheDocument();
    expect(screen.getByText('*****')).toBeInTheDocument();
  });

  it('shows submitting state when proof is being submitted', async () => {
    let resolveSubmit: (value: any) => void;
    const submitPromise = new Promise((resolve) => { resolveSubmit = resolve; });
    jest.spyOn(require('@/hooks/useVerification'), 'useVerification').mockReturnValue({
      submitProof: jest.fn().mockReturnValue(submitPromise),
      isVerifying: false,
    });

    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));

    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });

    expect(screen.getByText('Submitting Proof...')).toBeInTheDocument();

    await act(async () => {
      resolveSubmit!({ verified: true });
    });
  });

  it('shows step 2 of 4 on generate-proof step', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
  });

  it('shows step 3 of 4 on submit-proof step', () => {
    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();
  });

  it('passes onError to ProofGenerator on generate-proof step (covers line 227)', () => {
    // Override ProofGenerator mock to call onError
    jest.spyOn(
      require('@/components/zkp/ProofGenerator'),
      'default'
    ).mockImplementation(({ onError }: any) => (
      <div data-testid="proof-generator">
        <button onClick={() => onError('proof failed')}>
          Mock Error
        </button>
      </div>
    ));

    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    // Now on generate-proof step
    fireEvent.click(screen.getByText('Mock Error'));
    // Error should be displayed
    expect(screen.getByText('proof failed')).toBeInTheDocument();
  });

  it('renders correctly when request has no verifierName', () => {
    const reqNoVerifier = { ...mockRequest, verifierName: undefined };
    render(<VerificationFlow request={reqNoVerifier as any} />);
    expect(screen.getByText('Generate a zero-knowledge proof of your credentials')).toBeInTheDocument();
  });

  it('handles disclosureSelection with empty disclosed array (covers rendering path)', async () => {
    // Override SelectiveDisclosureBuilder to return selection with empty disclosed
    jest.spyOn(
      require('@/components/verification/SelectiveDisclosureBuilder'),
      'default'
    ).mockImplementation(({ onComplete }: any) => (
      <div data-testid="selective-disclosure-builder">
        <button
          onClick={() => onComplete({ disclosed: [], zkProved: [], hidden: [] })}
        >
          Mock Complete Selection
        </button>
      </div>
    ));

    render(<VerificationFlow request={mockRequest as any} />);
    fireEvent.click(screen.getByText('Mock Complete Selection'));
    fireEvent.click(screen.getByText('Mock Generate Proof'));
    // On submit step, disclosed is [] so fallback text shows
    expect(screen.getByText('No attributes directly disclosed')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Proof'));
    });
    expect(screen.getByText('Verification Successful')).toBeInTheDocument();
  });
});
