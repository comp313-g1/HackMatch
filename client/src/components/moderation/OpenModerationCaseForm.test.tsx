import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenModerationCaseForm } from './OpenModerationCaseForm';

describe('OpenModerationCaseForm (US-026 / #241)', () => {
  it('keeps entered values and shows validation when reason is blank', async () => {
    const onSubmit = vi.fn();
    render(<OpenModerationCaseForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('moderation-target-id'), {
      target: { value: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    fireEvent.change(screen.getByTestId('moderation-reason'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('open-case-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/reason is required/i);
    expect(screen.getByTestId('moderation-target-id')).toHaveValue(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    );
    expect(screen.getByTestId('moderation-reason')).toHaveValue('   ');
  });

  it('requires flaggedUrl for url targets and preserves the draft', () => {
    const onSubmit = vi.fn();
    render(<OpenModerationCaseForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('moderation-target-type'), {
      target: { value: 'url' },
    });
    fireEvent.change(screen.getByTestId('moderation-target-id'), {
      target: { value: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    fireEvent.change(screen.getByTestId('moderation-reason'), {
      target: { value: 'Phishing link' },
    });
    fireEvent.change(screen.getByTestId('moderation-flagged-url'), {
      target: { value: 'http://bad.example' },
    });
    fireEvent.click(screen.getByTestId('open-case-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/https URL/i)).toBeInTheDocument();
    expect(screen.getByTestId('moderation-flagged-url')).toHaveValue('http://bad.example');
    expect(screen.getByTestId('moderation-reason')).toHaveValue('Phishing link');
  });

  it('submits a valid team case payload', () => {
    const onSubmit = vi.fn();
    render(<OpenModerationCaseForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('moderation-target-id'), {
      target: { value: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    fireEvent.change(screen.getByTestId('moderation-reason'), {
      target: { value: 'Suspicious pitch' },
    });
    fireEvent.click(screen.getByTestId('open-case-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      targetType: 'team',
      targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reason: 'Suspicious pitch',
      flaggedUrl: null,
    });
  });

  it('shows server field errors while keeping form values', () => {
    render(
      <OpenModerationCaseForm
        onSubmit={vi.fn()}
        fieldErrors={{ reason: 'reason is required.' }}
        formError="Validation failed. Your entered values were kept."
      />
    );
    fireEvent.change(screen.getByTestId('moderation-reason'), {
      target: { value: 'kept draft' },
    });
    expect(screen.getByTestId('open-case-form-error')).toHaveTextContent(/kept/);
    expect(screen.getByTestId('moderation-reason')).toHaveValue('kept draft');
  });
});
