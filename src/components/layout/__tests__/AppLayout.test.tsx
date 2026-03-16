import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

let mockPathname = '/';

jest.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, prop: string) => {
      if (typeof prop === 'string') {
        return React.forwardRef((props: any, ref: any) => {
          const { initial, animate, exit, transition, whileHover, whileTap, variants, layout, ...rest } = props;
          const Tag = prop as any;
          return <Tag ref={ref} {...rest} />;
        });
      }
    },
  }),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target: unknown, prop: string | symbol) => {
    if (prop === '__esModule') return true;
    return (props: any) => <div data-testid={`icon-${String(prop).toLowerCase()}`} {...props} />;
  },
}));

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, href, onClick, ...rest }: any) {
    return <a href={href} onClick={onClick} {...rest}>{children}</a>;
  };
});

jest.mock('../Sidebar', () => ({
  Sidebar: ({ className, mobile, onToggle }: any) => (
    <nav data-testid={mobile ? 'mobile-sidebar' : 'sidebar'} className={className}>
      Sidebar
      <button data-testid={mobile ? 'mobile-sidebar-close' : 'desktop-sidebar-toggle'} onClick={onToggle}>
        {mobile ? 'Close' : 'Toggle'}
      </button>
    </nav>
  ),
}));

jest.mock('../Header', () => ({
  Header: ({ onMenuClick, onSearchClick }: any) => (
    <header data-testid="header">
      <button onClick={onMenuClick}>Menu</button>
      <button onClick={onSearchClick}>Search</button>
    </header>
  ),
}));

import { AppLayout, NAV_SECTIONS, NAV_ITEMS } from '../AppLayout';
import DefaultAppLayout from '../AppLayout';

beforeEach(() => {
  mockPathname = '/';
  document.body.style.overflow = '';
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AppLayout', () => {
  it('renders without crashing', () => {
    render(
      <AppLayout>
        <div>Page Content</div>
      </AppLayout>
    );
    expect(screen.getByText('Page Content')).toBeInTheDocument();
  });

  it('renders children inside main content area', () => {
    render(
      <AppLayout>
        <h1>Dashboard</h1>
      </AppLayout>
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders sidebar and header', () => {
    render(
      <AppLayout>
        <div>Content</div>
      </AppLayout>
    );
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
  });

  it('renders footer with version info', () => {
    render(
      <AppLayout>
        <div>Content</div>
      </AppLayout>
    );
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Aethelred Network')).toBeInTheDocument();
  });

  it('renders ZeroID branding in footer', () => {
    render(
      <AppLayout>
        <div>Content</div>
      </AppLayout>
    );
    expect(screen.getByText('ZeroID')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('handles desktop sidebar toggle callback (no-op)', () => {
    render(
      <AppLayout>
        <div>Content</div>
      </AppLayout>
    );
    // The desktop sidebar's onToggle is a no-op function, but calling it should not throw
    fireEvent.click(screen.getByTestId('desktop-sidebar-toggle'));
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  describe('Mobile Sidebar', () => {
    it('opens mobile sidebar when menu button is clicked', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      expect(screen.queryByTestId('mobile-sidebar')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Menu'));

      expect(screen.getByTestId('mobile-sidebar')).toBeInTheDocument();
    });

    it('closes mobile sidebar when close button is clicked', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Menu'));
      expect(screen.getByTestId('mobile-sidebar')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('mobile-sidebar-close'));
      expect(screen.queryByTestId('mobile-sidebar')).not.toBeInTheDocument();
    });

    it('closes mobile sidebar when backdrop is clicked', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Menu'));
      expect(screen.getByTestId('mobile-sidebar')).toBeInTheDocument();

      // The backdrop is the div with bg-black/70 class rendered alongside the sidebar
      const backdrop = document.querySelector('.fixed.inset-0.z-40');
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop!);

      expect(screen.queryByTestId('mobile-sidebar')).not.toBeInTheDocument();
    });

    it('locks body overflow when mobile sidebar is open', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      expect(document.body.style.overflow).toBe('');

      fireEvent.click(screen.getByText('Menu'));
      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.click(screen.getByTestId('mobile-sidebar-close'));
      expect(document.body.style.overflow).toBe('');
    });

    it('closes mobile sidebar on pathname change', () => {
      const { rerender } = render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Menu'));
      expect(screen.getByTestId('mobile-sidebar')).toBeInTheDocument();

      // Simulate pathname change
      mockPathname = '/identity';
      rerender(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      expect(screen.queryByTestId('mobile-sidebar')).not.toBeInTheDocument();
    });
  });

  describe('Search Overlay', () => {
    it('opens search overlay when search button is clicked', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      expect(screen.queryByRole('search')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Search'));

      expect(screen.getByRole('search')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search pages, actions...')).toBeInTheDocument();
    });

    it('opens search overlay with Cmd+K keyboard shortcut', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      expect(screen.queryByRole('search')).not.toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'k', metaKey: true });

      expect(screen.getByRole('search')).toBeInTheDocument();
    });

    it('opens search overlay with Ctrl+K keyboard shortcut', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });

      expect(screen.getByRole('search')).toBeInTheDocument();
    });

    it('toggles search overlay with Cmd+K', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      // Open
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      expect(screen.getByRole('search')).toBeInTheDocument();

      // Close
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
      expect(screen.queryByRole('search')).not.toBeInTheDocument();
    });

    it('closes search overlay with Escape key', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));
      expect(screen.getByRole('search')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('search')).not.toBeInTheDocument();
    });

    it('does not close with Escape when search is not open', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      // Should not throw or cause issues
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('search')).not.toBeInTheDocument();
    });

    it('closes search overlay when backdrop is clicked', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));
      expect(screen.getByRole('search')).toBeInTheDocument();

      // The backdrop is the fixed inset-0 div with bg-black/70
      const backdrop = document.querySelector('[role="search"] > .fixed.inset-0');
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop!);

      expect(screen.queryByRole('search')).not.toBeInTheDocument();
    });

    it('displays all search items when no query is entered', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));

      // Should show section labels
      expect(screen.getByText('Core')).toBeInTheDocument();
      expect(screen.getByText('Intelligence')).toBeInTheDocument();
      expect(screen.getByText('Enterprise')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('filters search items based on query', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));

      const input = screen.getByPlaceholderText('Search pages, actions...');
      fireEvent.change(input, { target: { value: 'governance' } });

      // Should show Governance items
      expect(screen.getByText('Governance')).toBeInTheDocument();

      // Should not show unrelated items like Dashboard
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    });

    it('shows no results message when query matches nothing', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));

      const input = screen.getByPlaceholderText('Search pages, actions...');
      fireEvent.change(input, { target: { value: 'xyznonexistent' } });

      expect(screen.getByText('No results found')).toBeInTheDocument();
    });

    it('resets query when search is reopened', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      // Open and type a query
      fireEvent.click(screen.getByText('Search'));
      const input = screen.getByPlaceholderText('Search pages, actions...');
      fireEvent.change(input, { target: { value: 'governance' } });

      // Close
      fireEvent.keyDown(document, { key: 'Escape' });

      // Reopen
      fireEvent.click(screen.getByText('Search'));

      const newInput = screen.getByPlaceholderText('Search pages, actions...');
      expect(newInput).toHaveValue('');
    });

    it('focuses the input when search opens', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));

      // The component uses setTimeout(() => inputRef.current?.focus(), 100)
      act(() => {
        jest.advanceTimersByTime(100);
      });

      const input = screen.getByPlaceholderText('Search pages, actions...');
      expect(document.activeElement).toBe(input);
    });

    it('closes search overlay when a search result link is clicked', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));
      expect(screen.getByRole('search')).toBeInTheDocument();

      // Click on a search result link (e.g., Dashboard)
      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toBeTruthy();
      fireEvent.click(dashboardLink!);

      expect(screen.queryByRole('search')).not.toBeInTheDocument();
    });

    it('shows keyboard shortcut hints in search overlay', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));

      expect(screen.getByText('ESC')).toBeInTheDocument();
      expect(screen.getByText('Enter')).toBeInTheDocument();
      expect(screen.getByText('select')).toBeInTheDocument();
      expect(screen.getByText('close')).toBeInTheDocument();
    });

    it('performs case-insensitive search', () => {
      render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Search'));

      const input = screen.getByPlaceholderText('Search pages, actions...');
      fireEvent.change(input, { target: { value: 'DASHBOARD' } });

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  describe('Keyboard event cleanup', () => {
    it('removes keydown listener on unmount', () => {
      const removeEventSpy = jest.spyOn(document, 'removeEventListener');

      const { unmount } = render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      unmount();

      expect(removeEventSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      removeEventSpy.mockRestore();
    });

    it('restores body overflow on unmount', () => {
      const { unmount } = render(
        <AppLayout>
          <div>Content</div>
        </AppLayout>
      );

      fireEvent.click(screen.getByText('Menu'));
      expect(document.body.style.overflow).toBe('hidden');

      unmount();

      expect(document.body.style.overflow).toBe('');
    });
  });
});

describe('NAV_SECTIONS', () => {
  it('exports navigation sections', () => {
    expect(NAV_SECTIONS).toBeDefined();
    expect(NAV_SECTIONS.length).toBeGreaterThan(0);
    expect(NAV_SECTIONS[0].title).toBe('Core');
  });

  it('has all expected sections', () => {
    const titles = NAV_SECTIONS.map((s) => s.title);
    expect(titles).toEqual(['Core', 'Intelligence', 'Enterprise', 'System']);
  });

  it('each section has items with label, href, and icon', () => {
    NAV_SECTIONS.forEach((section) => {
      section.items.forEach((item) => {
        expect(item.label).toBeTruthy();
        expect(item.href).toBeTruthy();
        expect(item.icon).toBeTruthy();
      });
    });
  });

  it('some items have badges', () => {
    const allItems = NAV_SECTIONS.flatMap((s) => s.items);
    const badgedItems = allItems.filter((i) => i.badge);
    expect(badgedItems.length).toBeGreaterThan(0);
    expect(badgedItems.find((i) => i.label === 'AI Compliance')?.badge).toBe('AI');
    expect(badgedItems.find((i) => i.label === 'Agent Identity')?.badge).toBe('New');
  });
});

describe('NAV_ITEMS', () => {
  it('exports a flat list of nav items', () => {
    expect(NAV_ITEMS).toBeDefined();
    expect(NAV_ITEMS.length).toBeGreaterThan(0);
    expect(NAV_ITEMS[0]).toHaveProperty('label');
    expect(NAV_ITEMS[0]).toHaveProperty('href');
  });

  it('is the flattened version of NAV_SECTIONS', () => {
    const expected = NAV_SECTIONS.flatMap((s) => s.items);
    expect(NAV_ITEMS).toEqual(expected);
  });
});

describe('default export', () => {
  it('exports AppLayout as default', () => {
    expect(DefaultAppLayout).toBe(AppLayout);
  });

  it('renders via default export', () => {
    render(
      <DefaultAppLayout>
        <div>Default Export Content</div>
      </DefaultAppLayout>
    );
    expect(screen.getByText('Default Export Content')).toBeInTheDocument();
  });
});
