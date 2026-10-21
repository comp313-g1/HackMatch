import React, { useState } from 'react';
import { SubmissionReviewGate } from './SubmissionReviewGate';
import { isSubmissionId } from './submissionReview';

export function SubmissionReviewPage({ onOpenEvent }: { onOpenEvent: (id: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(() => new URLSearchParams(window.location.search).get('submissionId') ?? '');
  const [selected, setSelected] = useState(draft.trim());
  const [error, setError] = useState('');
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Event submission review</h1>
      <p>Inspect ADMIN feedback before recruiting. Pending submissions cannot support teams, availability, invitations, or applications.</p>
      <form noValidate onSubmit={e => {
        e.preventDefault();
        const id = draft.trim();
        if (!isSubmissionId(id)) {
          setError('Enter a valid submission ID (UUID).');
          setSelected('');
          return;
        }
        setError('');
        setSelected(id);
      }} className="space-y-2">
        <label htmlFor="submission-id" className="block font-semibold">Submission ID</label>
        <input id="submission-id" value={draft} onChange={e => { setDraft(e.target.value); setSelected(''); setError(''); }}
          aria-invalid={Boolean(error)} aria-describedby={error ? 'submission-id-error' : undefined}
          className="w-full rounded border p-2" />
        {error && <p id="submission-id-error" role="alert">{error}</p>}
        <button type="submit" className="rounded bg-forest px-4 py-2 text-white">Check review status</button>
      </form>
      <SubmissionReviewGate submissionId={selected}>
        {eventId => <button type="button" onClick={() => onOpenEvent(eventId)} className="rounded bg-forest px-4 py-2 text-white">Open canonical event team board</button>}
      </SubmissionReviewGate>
    </div>
  );
}
