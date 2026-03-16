import React from 'react';
import { render } from '@testing-library/react';

// Mock next/head to render children in the document body for testing
jest.mock('next/head', () => {
  return function MockHead({ children }: { children: React.ReactNode }) {
    return <div data-testid="head">{children}</div>;
  };
});

import { SEOHead } from '../SEOHead';

describe('SEOHead', () => {
  it('renders without crashing', () => {
    const { getByTestId } = render(<SEOHead />);
    expect(getByTestId('head')).toBeInTheDocument();
  });

  it('uses default title when no title is provided', () => {
    const { container } = render(<SEOHead />);
    const title = container.querySelector('title');
    expect(title?.textContent).toBe('ZeroID on Aethelred');
  });

  it('appends site name to custom title', () => {
    const { container } = render(<SEOHead title="Dashboard" />);
    const title = container.querySelector('title');
    expect(title?.textContent).toBe('Dashboard | ZeroID on Aethelred');
  });

  it('renders description meta tag', () => {
    const { container } = render(<SEOHead description="Custom description" />);
    const meta = container.querySelector('meta[name="description"]');
    expect(meta?.getAttribute('content')).toBe('Custom description');
  });

  it('renders noindex meta when noIndex is true', () => {
    const { container } = render(<SEOHead noIndex />);
    const meta = container.querySelector('meta[name="robots"]');
    expect(meta?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('renders canonical link when canonical is provided', () => {
    const { container } = render(<SEOHead canonical="/dashboard" />);
    const link = container.querySelector('link[rel="canonical"]');
    expect(link?.getAttribute('href')).toBe('https://zeroid.aethelred.io/dashboard');
  });

  it('includes default keywords', () => {
    const { container } = render(<SEOHead />);
    const meta = container.querySelector('meta[name="keywords"]');
    const keywords = meta?.getAttribute('content') ?? '';
    expect(keywords).toContain('self-sovereign identity');
    expect(keywords).toContain('Aethelred');
  });
});
