import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AuditPagination, type AuditPaginationProps } from './AuditPagination';

function setup(over: Partial<AuditPaginationProps> = {}) {
  const props: AuditPaginationProps = {
    pageIndex: 0,
    pageSize: 25,
    hasMore: true,
    busy: false,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onPageSizeChange: vi.fn(),
    ...over,
  };
  render(<AuditPagination {...props} />);
  return props;
}

describe('AuditPagination (US-028 / #261)', () => {
  it('is a labelled navigation landmark', () => {
    setup();
    expect(screen.getByRole('navigation', { name: /audit records pagination/i })).toBeInTheDocument();
  });

  it('shows a 1-based page number marked as the current page', () => {
    setup({ pageIndex: 4 });
    const indicator = screen.getByTestId('audit-page-indicator');
    expect(indicator).toHaveTextContent('Page 5');
    expect(indicator).toHaveAttribute('aria-current', 'page');
  });

  it('on the first page: Previous is disabled, Next is enabled', () => {
    setup({ pageIndex: 0, hasMore: true });
    expect(screen.getByTestId('audit-page-prev')).toBeDisabled();
    expect(screen.getByTestId('audit-page-next')).toBeEnabled();
  });

  it('on a middle page: both directions are enabled', () => {
    setup({ pageIndex: 2, hasMore: true });
    expect(screen.getByTestId('audit-page-prev')).toBeEnabled();
    expect(screen.getByTestId('audit-page-next')).toBeEnabled();
  });

  it('on the last page: Next is disabled, Previous is enabled', () => {
    setup({ pageIndex: 3, hasMore: false });
    expect(screen.getByTestId('audit-page-prev')).toBeEnabled();
    expect(screen.getByTestId('audit-page-next')).toBeDisabled();
  });

  it('calls the right handler for each button', () => {
    const props = setup({ pageIndex: 1 });
    fireEvent.click(screen.getByTestId('audit-page-prev'));
    fireEvent.click(screen.getByTestId('audit-page-next'));
    expect(props.onPrevious).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('disables everything while busy and says it is loading', () => {
    setup({ pageIndex: 1, busy: true });
    expect(screen.getByTestId('audit-page-prev')).toBeDisabled();
    expect(screen.getByTestId('audit-page-next')).toBeDisabled();
    expect(screen.getByTestId('audit-page-next')).toHaveTextContent(/loading/i);
    expect(screen.getByTestId('audit-page-size')).toBeDisabled();
  });

  it('offers exactly the page sizes the server allows (25, 50, 100)', () => {
    setup({ pageSize: 50 });
    const select = screen.getByLabelText(/records per page/i);
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['25', '50', '100']);
    expect(select).toHaveValue('50');
  });

  it('reports a page-size change as a number', () => {
    const props = setup();
    fireEvent.change(screen.getByTestId('audit-page-size'), { target: { value: '100' } });
    expect(props.onPageSizeChange).toHaveBeenCalledWith(100);
  });
});
