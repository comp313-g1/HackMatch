import React, { useEffect, useState } from 'react';
import { ApplicationForm } from './ApplicationForm';
import {
  APPLICATION_MESSAGE_MAX_LENGTH,
  APPLICATION_PENDING_LIMIT_MESSAGE,
  ApplicationsApiError,
  AuthRequiredError,
  DUPLICATE_PENDING_APPLICATION_MESSAGE,
  isApplicationMessageTooLong,
  normalizeApplicationMessage,
  submitTeamApplication,
} from './applicationsApi';
import type { OpenTeamApplyTarget } from './openTeamsApi';

export interface ApplicationFormPanelProps {
  target: OpenTeamApplyTarget | null;
  onClose: () => void;
  onSuccess?: (notice: string) => void;
}

/**
 * Stateful US-018 / #171 / #176 apply panel: optional 250-char message, loading/success/error,
 * draft retained on validation and API failures (NR-017).
 */
export function ApplicationFormPanel({
  target,
  onClose,
  onSuccess,
}: ApplicationFormPanelProps): React.JSX.Element | null {
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ message?: string; vacancyId?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMessage('');
    setFieldErrors({});
    setSubmitError(null);
    setSuccessNotice(null);
    setSubmitting(false);
  }, [target?.teamId, target?.vacancyId, target?.slotId]);

  if (!target) {
    return null;
  }

  const targetSlotId = target.vacancyId || target.slotId || '';

  const validate = (): boolean => {
    const errors: { message?: string; vacancyId?: string } = {};
    if (!targetSlotId) {
      errors.vacancyId = 'Select an open slot to apply.';
    }
    if (isApplicationMessageTooLong(message)) {
      errors.message = `Message must be at most ${APPLICATION_MESSAGE_MAX_LENGTH} characters.`;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);
    setSuccessNotice(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const application = await submitTeamApplication(target.teamId, {
        vacancyId: targetSlotId,
        ...(target.slotId ? { slotId: target.slotId } : {}),
        message: normalizeApplicationMessage(message),
      });
      const notice =
        application.notice ||
        `Pending Review application submitted for the ${application.vacancyRole || target.role} slot on "${application.teamName || target.teamName}".`;
      setSuccessNotice(notice);
      setFieldErrors({});
      setMessage('');
      onSuccess?.(notice);
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        setSubmitError('You need to sign in to submit an application.');
      } else if (err instanceof ApplicationsApiError) {
        if (err.code === 'APPLICATION_PENDING_LIMIT') {
          setSubmitError(
            err.errors?._form || APPLICATION_PENDING_LIMIT_MESSAGE
          );
        } else if (err.code === 'DUPLICATE_PENDING_APPLICATION') {
          setSubmitError(
            err.errors?._form || DUPLICATE_PENDING_APPLICATION_MESSAGE
          );
        } else {
          setSubmitError(err.message || 'Could not submit application.');
        }
        if (err.errors) {
          setFieldErrors({
            message: err.errors.message,
            vacancyId: err.errors.vacancyId,
          });
        }
      } else {
        setSubmitError('Could not submit application.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-6 max-w-lg mx-auto" data-testid="application-form-panel">
      <ApplicationForm
        target={target}
        message={message}
        fieldErrors={fieldErrors}
        submitError={submitError}
        successNotice={successNotice}
        submitting={submitting}
        onMessageChange={setMessage}
        onSubmit={(e) => void handleSubmit(e)}
        onCancel={onClose}
      />
    </div>
  );
}
