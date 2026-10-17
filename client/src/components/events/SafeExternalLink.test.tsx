import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeExternalLink } from './SafeExternalLink.js';

describe('SafeExternalLink component unit tests (US-008 / #75)', () => {
  it('renders anchor tag with target="_blank" and rel="noopener noreferrer" for valid HTTPS URL', () => {
    render(<SafeExternalLink url="https://hackthenorth.com" label="Official Site" />);

    const link = screen.getByRole('link', { name: /official site/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://hackthenorth.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders non-navigable text when URL is null or empty', () => {
    const { rerender } = render(<SafeExternalLink url={null} label="Official Site" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Official link unavailable')).toBeInTheDocument();

    rerender(<SafeExternalLink url="   " label="Official Site" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Official link unavailable')).toBeInTheDocument();
  });

  it('renders non-navigable text when URL is HTTP (non-secure)', () => {
    render(<SafeExternalLink url="http://insecure.com" label="Official Site" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Official link unavailable')).toBeInTheDocument();
  });

  it('renders non-navigable text when URL is javascript: or data:', () => {
    const { rerender } = render(
      <SafeExternalLink url="javascript:alert(1)" label="Official Site" />
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Official link unavailable')).toBeInTheDocument();

    rerender(<SafeExternalLink url="data:text/html,<script>alert(1)</script>" label="Official Site" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Official link unavailable')).toBeInTheDocument();
  });
});
