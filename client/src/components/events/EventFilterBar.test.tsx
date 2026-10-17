import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventFilterBar } from './EventFilterBar.js';
import { EMPTY_FILTERS, type EventFilters } from './eventFilters.js';

describe('EventFilterBar component unit tests (US-008 / #74)', () => {
  it('renders search input and dropdown selects with accessible labels', () => {
    const handleChange = vi.fn();
    const handleClear = vi.fn();

    render(
      <EventFilterBar
        values={EMPTY_FILTERS}
        onChange={handleChange}
        onClear={handleClear}
      />
    );

    const keywordInput = screen.getByLabelText(/search keyword/i);
    const formatSelect = screen.getByLabelText(/^format$/i);
    const timeStateSelect = screen.getByLabelText(/event timing/i);

    expect(keywordInput).toBeInTheDocument();
    expect(formatSelect).toBeInTheDocument();
    expect(timeStateSelect).toBeInTheDocument();

    // Clear filters button should not show when no filters are active
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it('triggers onChange when keyword, format, or timeState change', () => {
    const handleChange = vi.fn();
    const handleClear = vi.fn();

    render(
      <EventFilterBar
        values={EMPTY_FILTERS}
        onChange={handleChange}
        onClear={handleClear}
      />
    );

    const keywordInput = screen.getByLabelText(/search keyword/i);
    fireEvent.change(keywordInput, { target: { value: 'Toronto' } });
    expect(handleChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      keyword: 'Toronto',
    });

    const formatSelect = screen.getByLabelText(/^format$/i);
    fireEvent.change(formatSelect, { target: { value: 'Virtual' } });
    expect(handleChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      format: 'Virtual',
    });

    const timeStateSelect = screen.getByLabelText(/event timing/i);
    fireEvent.change(timeStateSelect, { target: { value: 'upcoming' } });
    expect(handleChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      timeState: 'upcoming',
    });
  });

  it('shows clear filters button when filters are active and calls onClear on click', () => {
    const handleChange = vi.fn();
    const handleClear = vi.fn();
    const activeFilters: EventFilters = {
      keyword: 'Hack',
      format: '',
      timeState: '',
    };

    render(
      <EventFilterBar
        values={activeFilters}
        onChange={handleChange}
        onClear={handleClear}
      />
    );

    const clearButton = screen.getByRole('button', { name: /clear filters/i });
    expect(clearButton).toBeInTheDocument();

    fireEvent.click(clearButton);
    expect(handleClear).toHaveBeenCalled();
  });
});
