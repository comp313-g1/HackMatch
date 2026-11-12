import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecoveryCodesPanel, type RunSensitive } from './RecoveryCodesPanel';
import {
  AuthenticatorEnrollmentApiError,
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  type GeneratedRecoveryCodes,
} from './authenticatorEnrollmentApi';

vi.mock('./authenticatorEnrollmentApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./authenticatorEnrollmentApi')>();
  return {
    ...original,
    generateRecoveryCodes: vi.fn(),
    getRecoveryCodeStatus: vi.fn(),
  };
});

const BATCH_A = '30000000-0000-4000-8000-00000000000a';
const BATCH_B = '30000000-0000-4000-8000-00000000000b';
const CODES = [
  'AAAA-BBBB-CC22', 'DDDD-EEEE-FF33', 'GGGG-HHHH-JJ44', 'KKKK-LLLL-MM55', 'NNNN-PPPP-QQ66',
  'RRRR-SSSS-TT77', 'UUUU-VVVV-WW88', 'XXXX-YYYY-ZZ99', 'ABCD-EFGH-JK23', 'MNPQ-RSTU-VW45',
];

const generated = (batchId = BATCH_A, codes = CODES): GeneratedRecoveryCodes => ({
  status: 'generated',
  batchId,
  total: codes.length,
  remaining: codes.length,
  generatedAt: '2026-11-11T18:20:00.000Z',
  codes,
});

const passthrough: RunSensitive = (_purpose, operation) => operation();

function renderPanel(runSensitive: RunSensitive = passthrough) {
  const onAuthenticatorInactive = vi.fn();
  const view = render(
    <RecoveryCodesPanel runSensitive={runSensitive} onAuthenticatorInactive={onAuthenticatorInactive} />
  );
  return { ...view, onAuthenticatorInactive };
}

describe('RecoveryCodesPanel (US-029 / #269)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRecoveryCodeStatus).mockResolvedValue({ status: 'not_generated', total: 0, remaining: 0 });
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading and then an empty state with a generate action', async () => {
    renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent(/checking recovery codes/i);
    expect(await screen.findByTestId('recovery-codes-empty')).toHaveTextContent(/not generated/i);
    expect(screen.getByRole('button', { name: /^generate recovery codes$/i })).toBeEnabled();
  });

  it('generates through the reauthentication-aware runner and shows every code once', async () => {
    const runSensitive = vi.fn<RunSensitive>((_purpose, operation) => operation());
    vi.mocked(generateRecoveryCodes).mockResolvedValueOnce(generated());
    renderPanel(runSensitive as unknown as RunSensitive);

    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/generating recovery codes/i);

    const list = await screen.findByTestId('recovery-codes-list');
    expect(runSensitive).toHaveBeenCalledWith('generate recovery codes', expect.any(Function));
    expect(generateRecoveryCodes).toHaveBeenCalledWith(null);
    expect((list as HTMLTextAreaElement).value.split('\n')).toEqual(CODES);
    expect(list).toHaveAttribute('readonly');
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(screen.getByText(/store them somewhere safe/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /save your new recovery codes/i })).toHaveFocus()
    );
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(window.location.href).not.toContain('AAAA');

    fireEvent.click(screen.getByRole('button', { name: /i have saved these codes/i }));
    expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument();
    expect(screen.queryByText('AAAA-BBBB-CC22')).not.toBeInTheDocument();
    expect(screen.getByText(/of 10 recovery/i)).toBeInTheDocument();
    expect(screen.getByText(/never shown again/i)).toBeInTheDocument();
  });

  it('confirms before regenerating and sends the current batch id', async () => {
    vi.mocked(getRecoveryCodeStatus).mockResolvedValueOnce({
      status: 'generated',
      batchId: BATCH_A,
      total: 10,
      remaining: 3,
      generatedAt: '2026-11-11T18:20:00.000Z',
    });
    vi.mocked(generateRecoveryCodes).mockResolvedValueOnce(generated(BATCH_B));
    renderPanel();

    expect(await screen.findByText(/of 10 recovery codes unused/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /regenerate recovery codes/i }));
    expect(screen.getByText(/stops every current recovery code/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /keep current codes/i }));
    expect(generateRecoveryCodes).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /regenerate recovery codes/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate new codes/i }));
    expect(await screen.findByTestId('recovery-codes-list')).toBeInTheDocument();
    expect(generateRecoveryCodes).toHaveBeenCalledWith(BATCH_A);
  });

  it('warns when every code has been used', async () => {
    vi.mocked(getRecoveryCodeStatus).mockResolvedValueOnce({
      status: 'generated',
      batchId: BATCH_A,
      total: 10,
      remaining: 0,
      generatedAt: '2026-11-11T18:20:00.000Z',
    });
    renderPanel();
    expect(await screen.findByText(/every recovery code has been used/i)).toBeInTheDocument();
  });

  it('keeps the previous summary and shows no codes when generation fails', async () => {
    vi.mocked(getRecoveryCodeStatus).mockResolvedValueOnce({
      status: 'generated',
      batchId: BATCH_A,
      total: 10,
      remaining: 8,
      generatedAt: '2026-11-11T18:20:00.000Z',
    });
    vi.mocked(generateRecoveryCodes).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(
        503,
        'RECOVERY_CODES_UNAVAILABLE',
        'Recovery codes could not be generated. Your existing codes were not changed. Please try again.',
        true
      )
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /regenerate recovery codes/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate new codes/i }));

    expect(await screen.findByTestId('recovery-codes-error')).toHaveTextContent(/existing codes were not changed/i);
    expect(screen.getByText(/of 10 recovery codes unused/i)).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument();
  });

  it('refreshes the summary after a stale request from another session', async () => {
    vi.mocked(generateRecoveryCodes).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(409, 'RECOVERY_CODES_STALE', 'Your recovery codes were changed in another session.')
    );
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    vi.mocked(getRecoveryCodeStatus).mockResolvedValueOnce({
      status: 'generated',
      batchId: BATCH_B,
      total: 10,
      remaining: 10,
      generatedAt: '2026-11-11T18:25:00.000Z',
    });

    expect(await screen.findByTestId('recovery-codes-error')).toHaveTextContent(/another session/i);
    expect(screen.getByText(/of 10 recovery codes unused/i)).toBeInTheDocument();
    expect(getRecoveryCodeStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument();
  });

  it('reports a cancelled verification without changing codes', async () => {
    const cancelled: RunSensitive = () =>
      Promise.reject(
        new AuthenticatorEnrollmentApiError(0, 'REAUTHENTICATION_CANCELLED', 'cancelled')
      );
    renderPanel(cancelled);
    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    expect(await screen.findByTestId('recovery-codes-error')).toHaveTextContent(
      /verification was cancelled.*not changed/i
    );
    expect(generateRecoveryCodes).not.toHaveBeenCalled();
  });

  it('asks for verification instead of auto-prompting when status needs a recent sign-in', async () => {
    const runSensitive = vi.fn<RunSensitive>((_purpose, operation) => operation());
    vi.mocked(getRecoveryCodeStatus).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(401, 'REAUTHENTICATION_REQUIRED', 'Recent reauthentication is required.')
    );
    renderPanel(runSensitive as unknown as RunSensitive);
    const verify = await screen.findByRole('button', { name: /verify identity for recovery codes/i });
    expect(runSensitive).not.toHaveBeenCalled();
    fireEvent.click(verify);
    expect(await screen.findByTestId('recovery-codes-empty')).toBeInTheDocument();
    expect(runSensitive).toHaveBeenCalledWith('view your recovery codes', expect.any(Function));
  });

  it('notifies the parent when the authenticator is no longer active', async () => {
    vi.mocked(generateRecoveryCodes).mockRejectedValueOnce(
      new AuthenticatorEnrollmentApiError(409, 'AUTHENTICATOR_NOT_ACTIVE', 'There is no active authenticator.')
    );
    const { onAuthenticatorInactive } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    await waitFor(() => expect(onAuthenticatorInactive).toHaveBeenCalledTimes(1));
  });

  it('copies codes with a keyboard-reachable button and reports copy failures', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.mocked(generateRecoveryCodes).mockResolvedValueOnce(generated());
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    await screen.findByTestId('recovery-codes-list');

    fireEvent.click(screen.getByRole('button', { name: /copy recovery codes/i }));
    expect(await screen.findByText(/copied to your clipboard/i)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));

    fireEvent.click(screen.getByRole('button', { name: /copy recovery codes/i }));
    expect(await screen.findByText(/copy failed/i)).toBeInTheDocument();
  });

  it('shows a replacement-issued set once, without a status request, and releases the handoff', async () => {
    const onInitialCodesConsumed = vi.fn();
    render(
      <RecoveryCodesPanel
        runSensitive={passthrough}
        onAuthenticatorInactive={vi.fn()}
        initialCodes={generated(BATCH_B)}
        onInitialCodesConsumed={onInitialCodesConsumed}
      />
    );
    expect((screen.getByTestId('recovery-codes-list') as HTMLTextAreaElement).value.split('\n')).toEqual(CODES);
    expect(screen.getByTestId('recovery-codes-replacement-note')).toHaveTextContent(
      /previous recovery codes no longer work/i
    );
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(onInitialCodesConsumed).toHaveBeenCalledTimes(1);
    expect(getRecoveryCodeStatus).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /save your new recovery codes/i })).toHaveFocus()
    );

    fireEvent.click(screen.getByRole('button', { name: /i have saved these codes/i }));
    expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument();
    expect(screen.getByText(/of 10 recovery codes unused/i)).toBeInTheDocument();
    // Regenerating later targets the fresh batch, not the revoked one.
    vi.mocked(generateRecoveryCodes).mockResolvedValueOnce(generated(BATCH_A));
    fireEvent.click(screen.getByRole('button', { name: /regenerate recovery codes/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate new codes/i }));
    await screen.findByTestId('recovery-codes-list');
    expect(generateRecoveryCodes).toHaveBeenCalledWith(BATCH_B);
    expect(screen.queryByTestId('recovery-codes-replacement-note')).not.toBeInTheDocument();
  });

  it('drops raw codes from memory on unmount and never shows them on remount', async () => {
    vi.mocked(generateRecoveryCodes).mockResolvedValueOnce(generated());
    const first = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^generate recovery codes$/i }));
    await screen.findByTestId('recovery-codes-list');
    first.unmount();

    vi.mocked(getRecoveryCodeStatus).mockResolvedValueOnce({
      status: 'generated',
      batchId: BATCH_A,
      total: 10,
      remaining: 10,
      generatedAt: '2026-11-11T18:20:00.000Z',
    });
    renderPanel();
    expect(await screen.findByText(/of 10 recovery codes unused/i)).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-codes-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/AAAA-BBBB-CC22/)).not.toBeInTheDocument();
  });
});
