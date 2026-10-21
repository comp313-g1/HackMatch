import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModerationActionPanel } from './ModerationActionPanel';

describe('ModerationActionPanel (US-026 / #242)', () => {
  it('shows idle state when no case is selected', () => {
    render(
      <ModerationActionPanel
        caseId={null}
        caseStatus={null}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-action-idle')).toBeInTheDocument();
  });

  it('rejects submit without reason and keeps the selected action', () => {
    const onSubmit = vi.fn();
    render(
      <ModerationActionPanel
        caseId="11111111-1111-4111-8111-111111111111"
        caseStatus="Open"
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByTestId('moderation-action-hide'));
    fireEvent.change(screen.getByTestId('moderation-decision-reason'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('moderation-action-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('moderation-decision-reason-error')).toHaveTextContent(/required/i);
    expect(screen.getByTestId('moderation-decision-reason')).toHaveValue('   ');
    expect(screen.getByTestId('moderation-action-hide')).toBeChecked();
  });

  it('submits hide with a reason', () => {
    const onSubmit = vi.fn();
    render(
      <ModerationActionPanel
        caseId="11111111-1111-4111-8111-111111111111"
        caseStatus="Open"
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByTestId('moderation-action-hide'));
    fireEvent.change(screen.getByTestId('moderation-decision-reason'), {
      target: { value: 'Phishing listing' },
    });
    fireEvent.click(screen.getByTestId('moderation-action-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      action: 'hide',
      reason: 'Phishing listing',
    });
  });

  it('disables actions when the case is already closed', () => {
    render(
      <ModerationActionPanel
        caseId="11111111-1111-4111-8111-111111111111"
        caseStatus="Resolved"
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('moderation-action-closed')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-action-submit')).toBeDisabled();
  });
});
