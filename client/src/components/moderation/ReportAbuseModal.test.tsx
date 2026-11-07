import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportAbuseModal } from './ReportAbuseModal';
import type { ReportReceiptDto, ReportTargetSummary } from './reportTypes';

describe('ReportAbuseModal component (US-025 / #232 / #237)', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  const sampleTeamTarget: ReportTargetSummary = {
    targetType: 'team',
    targetId: '11111111-1111-4111-8111-111111111111',
    targetName: 'Alpha Squad',
  };

  const sampleReceipt: ReportReceiptDto = {
    reportId: '99999999-9999-4999-8999-999999999999',
    caseId: '88888888-8888-4888-8888-888888888888',
    targetType: 'team',
    targetId: sampleTeamTarget.targetId,
    category: 'Harassment',
    status: 'Received',
    submittedAt: '2026-11-06T12:00:00.000Z',
    confirmationMessage:
      'Your report has been received and queued for administrator review.',
    rateLimit: {
      limit: 5,
      remaining: 4,
      windowSeconds: 3600,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ReportAbuseModal
        isOpen={false}
        target={sampleTeamTarget}
        onClose={mockOnClose}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with WCAG 2.1 AA dialog attributes and target information', () => {
    render(
      <ReportAbuseModal
        isOpen={true}
        target={sampleTeamTarget}
        onClose={mockOnClose}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute(
      'aria-labelledby',
      'report-abuse-modal-title'
    );
    expect(dialog).toHaveAttribute(
      'aria-describedby',
      'report-abuse-modal-desc'
    );

    expect(screen.getByText(/Report Team Listing/i)).toBeInTheDocument();
    expect(screen.getByText(/Target: Alpha Squad/i)).toBeInTheDocument();
    expect(
      screen.getByText(`ID: ${sampleTeamTarget.targetId}`)
    ).toBeInTheDocument();
  });

  it('validates required category on submit and preserves entered explanation (NR-010)', async () => {
    render(
      <ReportAbuseModal
        isOpen={true}
        target={sampleTeamTarget}
        onClose={mockOnClose}
      />
    );

    const explanationInput = screen.getByLabelText(/Explanation/i);
    fireEvent.change(explanationInput, {
      target: { value: 'This team is posting harassing recruitment messages.' },
    });

    const submitBtn = screen.getByTestId('submit-report-btn');
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Please select a valid category/i);

    // Form data must be preserved on error (NR-010)
    expect(explanationInput).toHaveValue(
      'This team is posting harassing recruitment messages.'
    );
  });

  it('displays 429 rate-limit error message with retry hint while preserving form input (AC 3 / NR-010)', async () => {
    const mockSubmitFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      error: {
        code: 'RATE_LIMITED',
        message:
          'Rate limit exceeded: You may submit at most 5 reports per rolling hour.',
        retryAfterSeconds: 1800,
      },
    });

    render(
      <ReportAbuseModal
        isOpen={true}
        target={sampleTeamTarget}
        onClose={mockOnClose}
        submitReportFn={mockSubmitFn}
      />
    );

    const categorySelect = screen.getByLabelText(/Report Category/i);
    fireEvent.change(categorySelect, { target: { value: 'Spam' } });

    const explanationInput = screen.getByLabelText(/Explanation/i);
    fireEvent.change(explanationInput, {
      target: { value: 'Mass spam messages.' },
    });

    fireEvent.click(screen.getByTestId('submit-report-btn'));

    await waitFor(() => {
      expect(mockSubmitFn).toHaveBeenCalled();
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Rate limit exceeded/i);
    expect(screen.getByTestId('report-retry-hint')).toHaveTextContent(
      /30 minute\(s\) \(1800 seconds\)/i
    );

    // Form inputs preserved
    expect(categorySelect).toHaveValue('Spam');
    expect(explanationInput).toHaveValue('Mass spam messages.');
  });

  it('displays 201 receipt confirmation with receipt ID, case ID, and remaining count (AC 4)', async () => {
    const mockSubmitFn = vi.fn().mockResolvedValue({
      ok: true,
      data: sampleReceipt,
    });

    render(
      <ReportAbuseModal
        isOpen={true}
        target={sampleTeamTarget}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
        submitReportFn={mockSubmitFn}
      />
    );

    const categorySelect = screen.getByLabelText(/Report Category/i);
    fireEvent.change(categorySelect, { target: { value: 'Harassment' } });

    fireEvent.click(screen.getByTestId('submit-report-btn'));

    await waitFor(() => {
      expect(mockSubmitFn).toHaveBeenCalled();
      expect(mockOnSuccess).toHaveBeenCalledWith(sampleReceipt);
    });

    const statusContainer = await screen.findByRole('status');
    expect(statusContainer).toHaveTextContent(/Report Received/i);
    expect(screen.getByText(sampleReceipt.reportId)).toBeInTheDocument();
    expect(screen.getByText(sampleReceipt.caseId)).toBeInTheDocument();
    expect(screen.getByText(/4 of 5/i)).toBeInTheDocument();

    const doneBtn = screen.getByTestId('report-receipt-done-btn');
    fireEvent.click(doneBtn);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders flaggedUrl field and validates https URL when targetType is url', async () => {
    const urlTarget: ReportTargetSummary = {
      targetType: 'url',
      targetId: '22222222-2222-4222-8222-222222222222',
      targetName: 'Suspicious external link',
    };

    render(
      <ReportAbuseModal
        isOpen={true}
        target={urlTarget}
        onClose={mockOnClose}
      />
    );

    const urlInput = screen.getByPlaceholderText(
      'https://example.com/suspicious-link'
    );
    expect(urlInput).toBeInTheDocument();

    const categorySelect = screen.getByLabelText(/Report Category/i);
    fireEvent.change(categorySelect, { target: { value: 'Phishing Link' } });

    fireEvent.change(urlInput, { target: { value: 'http://insecure.url' } });

    fireEvent.click(screen.getByTestId('submit-report-btn'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/must be a valid https:\/\/ URL/i);
  });
});
