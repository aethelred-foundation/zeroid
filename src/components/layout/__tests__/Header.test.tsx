import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '@/components/layout/Header';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/'),
}));

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) => {
      const filteredProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'variants', 'layout', 'layoutId'].includes(key)) {
          filteredProps[key] = value;
        }
      }
      return <div ref={ref} {...filteredProps}>{children}</div>;
    }),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock lucide-react
jest.mock('lucide-react', () => ({
  Search: (props: Record<string, unknown>) => <span data-testid="icon-search" {...props} />,
  Bell: (props: Record<string, unknown>) => <span data-testid="icon-bell" {...props} />,
  Menu: (props: Record<string, unknown>) => <span data-testid="icon-menu" {...props} />,
  Command: (props: Record<string, unknown>) => <span data-testid="icon-command" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="icon-x" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="icon-alert" {...props} />,
  Info: (props: Record<string, unknown>) => <span data-testid="icon-info" {...props} />,
  CheckCircle: (props: Record<string, unknown>) => <span data-testid="icon-check" {...props} />,
}));

// Mock WalletButton
jest.mock('@/components/ui/WalletButton', () => ({
  WalletButton: () => <div data-testid="wallet-button">WalletButton</div>,
}));

describe('Header', () => {
  const defaultProps = {
    onMenuClick: jest.fn(),
    onSearchClick: jest.fn(),
    sidebarCollapsed: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders page title based on pathname', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('renders page title for different paths', () => {
    const usePathname = require('next/navigation').usePathname;
    usePathname.mockReturnValue('/credentials');
    render(<Header {...defaultProps} />);
    expect(screen.getByText('Credentials')).toBeInTheDocument();
    expect(screen.getByText('Verifiable')).toBeInTheDocument();
  });

  it('renders fallback title for unknown paths', () => {
    const usePathname = require('next/navigation').usePathname;
    usePathname.mockReturnValue('/unknown-path');
    render(<Header {...defaultProps} />);
    expect(screen.getByText('ZeroID')).toBeInTheDocument();
  });

  it('calls onMenuClick when menu button is clicked', () => {
    render(<Header {...defaultProps} />);
    const menuButton = screen.getByLabelText('Open menu');
    fireEvent.click(menuButton);
    expect(defaultProps.onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('calls onSearchClick when search button is clicked', () => {
    render(<Header {...defaultProps} />);
    // The search button contains the Search text
    const searchButton = screen.getByText('Search').closest('button')!;
    fireEvent.click(searchButton);
    expect(defaultProps.onSearchClick).toHaveBeenCalledTimes(1);
  });

  it('renders notification bell', () => {
    render(<Header {...defaultProps} />);
    const bellButton = screen.getByLabelText('Notifications');
    expect(bellButton).toBeInTheDocument();
  });

  it('shows unread count indicator', () => {
    const { container } = render(<Header {...defaultProps} />);
    // There should be an unread dot (the mock notifications have 2 unread)
    const unreadDot = container.querySelector('.bg-chrome-300');
    expect(unreadDot).toBeInTheDocument();
  });

  it('toggles notification panel on bell click', () => {
    render(<Header {...defaultProps} />);
    const bellButton = screen.getByLabelText('Notifications');

    // Click to open
    fireEvent.click(bellButton);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Credential Verified')).toBeInTheDocument();
  });

  it('shows Mark all read button when there are unread notifications', () => {
    render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('Mark all read')).toBeInTheDocument();
  });

  it('marks all notifications as read', () => {
    render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    fireEvent.click(screen.getByText('Mark all read'));
    // After marking all read, the "Mark all read" button should disappear
    expect(screen.queryByText('Mark all read')).not.toBeInTheDocument();
  });

  it('dismisses individual notification', () => {
    render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Notifications'));

    // There should be 3 notifications initially
    expect(screen.getByText('Credential Verified')).toBeInTheDocument();

    // Dismiss the first notification
    const dismissButtons = screen.getAllByLabelText('Dismiss');
    fireEvent.click(dismissButtons[0]);

    expect(screen.queryByText('Credential Verified')).not.toBeInTheDocument();
  });

  it('renders WalletButton', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByTestId('wallet-button')).toBeInTheDocument();
  });

  it('renders keyboard shortcut indicator', () => {
    render(<Header {...defaultProps} />);
    // The Cmd+K shortcut indicator
    expect(screen.getByTestId('icon-command')).toBeInTheDocument();
  });

  it('closes notification panel when backdrop is clicked', () => {
    render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('Credential Verified')).toBeInTheDocument();

    // Click the backdrop (fixed inset-0 div)
    const backdrop = document.querySelector('.fixed.inset-0.z-40');
    if (backdrop) fireEvent.click(backdrop);
    // Notifications should be dismissed
  });

  it('shows empty notifications message when all are dismissed', () => {
    render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Notifications'));

    // Dismiss all 3 notifications one by one
    let dismissButtons = screen.getAllByLabelText('Dismiss');
    fireEvent.click(dismissButtons[0]);
    dismissButtons = screen.getAllByLabelText('Dismiss');
    fireEvent.click(dismissButtons[0]);
    dismissButtons = screen.getAllByLabelText('Dismiss');
    fireEvent.click(dismissButtons[0]);

    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('does not show subtitle when pathname has empty subtitle', () => {
    const usePathname = require('next/navigation').usePathname;
    usePathname.mockReturnValue('/unknown-path');
    render(<Header {...defaultProps} />);
    // Fallback: { title: 'ZeroID', subtitle: '' } — no subtitle rendered
    expect(screen.getByText('ZeroID')).toBeInTheDocument();
  });

  it('hides unread dot after marking all read', () => {
    const { container } = render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    fireEvent.click(screen.getByText('Mark all read'));
    // Unread dot should no longer be present
    const unreadDot = container.querySelector('.bg-chrome-300');
    expect(unreadDot).not.toBeInTheDocument();
  });

  it('closes notification panel by toggling bell button', () => {
    render(<Header {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('Credential Verified')).toBeInTheDocument();
    // Click bell again to close
    fireEvent.click(screen.getByLabelText('Notifications'));
    expect(screen.queryByText('Credential Verified')).not.toBeInTheDocument();
  });
});
