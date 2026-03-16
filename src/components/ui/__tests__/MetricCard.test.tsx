import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

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

import { MetricCard, MetricCardGrid } from '../MetricCard';

describe('MetricCard', () => {
  it('renders without crashing', () => {
    render(<MetricCard icon={<span>IC</span>} label="Total Users" value="1,234" />);
    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('displays trend information when provided', () => {
    render(
      <MetricCard
        icon={<span>IC</span>}
        label="Revenue"
        value="$50K"
        trend={{ direction: 'up', value: '+12%', label: 'vs last month' }}
      />
    );
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });

  it('shows loading skeleton when loading is true', () => {
    const { container } = render(
      <MetricCard icon={<span>IC</span>} label="Users" value="100" loading />
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
  });

  it('renders as a button when onClick is provided', () => {
    const onClick = jest.fn();
    render(
      <MetricCard icon={<span>IC</span>} label="Clickable" value="42" onClick={onClick} />
    );
    fireEvent.click(screen.getByText('42'));
    expect(onClick).toHaveBeenCalled();
  });

  it('displays subtitle when provided', () => {
    render(
      <MetricCard icon={<span>IC</span>} label="Score" value="95" subtitle="Out of 100" />
    );
    expect(screen.getByText('Out of 100')).toBeInTheDocument();
  });

  it('renders as div when onClick is not provided', () => {
    const { container } = render(
      <MetricCard icon={<span>IC</span>} label="Static" value="99" />
    );
    // Should not render as a button
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows trend label via subtitle fallback (subtitle empty, trend.label present)', () => {
    render(
      <MetricCard
        icon={<span>IC</span>}
        label="Score"
        value="80"
        trend={{ direction: 'down', value: '-5%', label: 'from last week' }}
      />
    );
    expect(screen.getByText('from last week')).toBeInTheDocument();
  });

  it('renders trend with neutral direction', () => {
    render(
      <MetricCard
        icon={<span>IC</span>}
        label="Neutral"
        value="50"
        trend={{ direction: 'neutral', value: '0%' }}
      />
    );
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('does not render trend or subtitle section when neither provided', () => {
    const { container } = render(
      <MetricCard icon={<span>IC</span>} label="Plain" value="10" />
    );
    // Should not render subtitle/trend p element
    expect(screen.queryByText('undefined')).toBeNull();
  });
});

describe('MetricCardGrid', () => {
  it('renders children in a grid', () => {
    const { container } = render(
      <MetricCardGrid columns={3}>
        <div>Card 1</div>
        <div>Card 2</div>
        <div>Card 3</div>
      </MetricCardGrid>
    );
    expect(container.querySelector('.grid')).toBeInTheDocument();
    expect(screen.getByText('Card 1')).toBeInTheDocument();
  });

  it('uses default 4 columns when columns prop is not provided', () => {
    const { container } = render(
      <MetricCardGrid>
        <div>Card 1</div>
      </MetricCardGrid>
    );
    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid.className).toContain('lg:grid-cols-4');
  });

  it('uses 2 columns when specified', () => {
    const { container } = render(
      <MetricCardGrid columns={2}>
        <div>Card 1</div>
      </MetricCardGrid>
    );
    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid.className).toContain('sm:grid-cols-2');
    expect(grid.className).not.toContain('lg:grid-cols');
  });

  it('applies custom className', () => {
    const { container } = render(
      <MetricCardGrid className="my-grid">
        <div>Card 1</div>
      </MetricCardGrid>
    );
    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid.className).toContain('my-grid');
  });
});
