import React, { useEffect, useId, useRef, useState } from 'react';
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
 *
 * #366: rendered as a viewport-centered dialog so Apply stays in context (no jump to page top).
 */
export function ApplicationFormPanel({
  target,
  onClose,
  onSuccess,
}: ApplicationFormPanelProps): React.JSX.Element | null {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ message?: string; vacancyId?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    setMessage('');
    setFieldErrors({});
    setSubmitError(null);
    setSuccessNotice(null);
    setSubmitting(false);
  }, [target?.teamId, target?.vacancyId, target?.slotId]);

  useEffect(() => {
    if (!target) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [target, onClose]);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      data-testid="application-form-panel"
    >
      <button
        type="button"
        aria-label="Dismiss apply form"
        className="absolute inset-0 bg-ink/40 border-0 cursor-pointer"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg max-h-[min(90vh,40rem)] overflow-y-auto rounded-xl shadow-lg outline-none"
      >
        <span id={titleId} className="sr-only">
          Apply to join {target.teamName}
        </span>
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
    </div>
  );
}
