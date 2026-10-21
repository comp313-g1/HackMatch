import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteAccountForm } from './DeleteAccountForm';

const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('DeleteAccountForm (US-027 / #255)', () => {
  it('shows idle guidance when no account is selected', () => {
    render(
      <DeleteAccountForm
        accountId={null}
        accountState={null}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('delete-account-idle')).toHaveTextContent(/ownership-verified/i);
  });

  it('shows deactivated notice when account is already gone', () => {
    render(
      <DeleteAccountForm
        accountId={accountId}
        accountState="Deactivated"
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByTestId('delete-account-deactivated')).toBeInTheDocument();
  });

  it('requires ownership confirmation and keeps the reason draft', () => {
    const onSubmit = vi.fn();
    render(
      <DeleteAccountForm
        accountId={accountId}
        accountState="Active"
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByTestId('delete-reason'), {
      target: { value: 'Owner asked for deletion' },
    });
    fireEvent.click(screen.getByTestId('delete-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-reason')).toHaveValue('Owner asked for deletion');
    expect(screen.getByTestId('delete-ownership-error')).toHaveTextContent(/ownership/i);
  });

  it('submits ownership-verified deletion payload', () => {
    const onSubmit = vi.fn();
    render(
      <DeleteAccountForm
        accountId={accountId}
        accountState="Active"
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByTestId('delete-reason'), {
      target: { value: '  Verified owner requested deletion  ' },
    });
    expect(screen.getByTestId('delete-reason-count')).toHaveTextContent(/\/2000/);
    fireEvent.click(screen.getByTestId('delete-ownership-verified'));
    fireEvent.click(screen.getByTestId('delete-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      reason: 'Verified owner requested deletion',
      ownershipVerified: true,
    });
  });

  it('shows failure notice while preserving draft values', () => {
    render(
      <DeleteAccountForm
        accountId={accountId}
        accountState="Active"
        onSubmit={vi.fn()}
        formError="Owner must disband unlocked teams. Your entered values were kept."
      />
    );
    fireEvent.change(screen.getByTestId('delete-reason'), {
      target: { value: 'kept reason' },
    });
    fireEvent.click(screen.getByTestId('delete-ownership-verified'));

    expect(screen.getByTestId('delete-form-error')).toHaveTextContent(/disband/);
    expect(screen.getByTestId('delete-reason')).toHaveValue('kept reason');
    expect(screen.getByTestId('delete-ownership-verified')).toBeChecked();
  });

  it('shows success notice after completion', () => {
    render(
      <DeleteAccountForm
        accountId={accountId}
        accountState="Active"
        onSubmit={vi.fn()}
        successNotice="Ownership-verified deletion completed."
      />
    );
    expect(screen.getByTestId('delete-success')).toHaveTextContent(/Ownership-verified deletion/);
  });
});
