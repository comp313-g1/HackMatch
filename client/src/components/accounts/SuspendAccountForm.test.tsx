import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuspendAccountForm } from './SuspendAccountForm';

const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('SuspendAccountForm (US-027 / #255)', () => {
  it('shows idle guidance when no account is selected', () => {
    render(
      <SuspendAccountForm
        accountId={null}
        accountState={null}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('suspend-account-idle')).toHaveTextContent(/Select an account/);
  });

  it('blocks suspension of deactivated accounts', () => {
    render(
      <SuspendAccountForm
        accountId={accountId}
        accountState="Deactivated"
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('suspend-account-deactivated')).toBeInTheDocument();
    expect(screen.queryByTestId('suspend-account-form')).not.toBeInTheDocument();
  });

  it('keeps entered reason on local validation failure', () => {
    const onSubmit = vi.fn();
    render(
      <SuspendAccountForm
        accountId={accountId}
        accountState="Active"
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByTestId('suspend-reason'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('suspend-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('suspend-reason')).toHaveValue('   ');
    expect(screen.getByText(/reason is required/i)).toBeInTheDocument();
  });

  it('submits a trimmed reason and tracks character count', () => {
    const onSubmit = vi.fn();
    render(
      <SuspendAccountForm
        accountId={accountId}
        accountState="Active"
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByTestId('suspend-reason'), {
      target: { value: '  Harassment  ' },
    });
    expect(screen.getByTestId('suspend-reason-count')).toHaveTextContent('14/2000');
    fireEvent.click(screen.getByTestId('suspend-submit'));

    expect(onSubmit).toHaveBeenCalledWith({ reason: 'Harassment' });
  });

  it('shows success notice after suspension', () => {
    render(
      <SuspendAccountForm
        accountId={accountId}
        accountState="Active"
        onSubmit={vi.fn()}
        successNotice="Account suspended."
      />
    );
    expect(screen.getByTestId('suspend-success')).toHaveTextContent(/Account suspended/);
  });

  it('shows server field errors while keeping the draft', () => {
    render(
      <SuspendAccountForm
        accountId={accountId}
        accountState="Active"
        onSubmit={vi.fn()}
        fieldErrors={{ reason: 'reason is required.' }}
        formError="Validation failed. Your entered reason was kept."
      />
    );
    fireEvent.change(screen.getByTestId('suspend-reason'), {
      target: { value: 'kept draft' },
    });
    expect(screen.getByTestId('suspend-form-error')).toHaveTextContent(/kept/);
    expect(screen.getByTestId('suspend-reason')).toHaveValue('kept draft');
    expect(screen.getByText(/reason is required/i)).toBeInTheDocument();
  });

  it('shows already-suspended notice for re-apply', () => {
    render(
      <SuspendAccountForm
        accountId={accountId}
        accountState="Suspended"
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('suspend-already-notice')).toHaveTextContent(/already suspended/i);
  });
});
