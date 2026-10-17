import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignedInPanel } from './SignedInPanel';
import { logout } from './logout';
import * as authFetchModule from '../../config/authFetch';

vi.mock('./logout', () => ({
  logout: vi.fn(),
}));

const mockLogout = vi.mocked(logout);

describe('SignedInPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
  });

  it('shows the signed-in welcome and a sign out button', () => {
    render(<SignedInPanel email="jane@example.com" />);

    expect(screen.getByText(/you are signed in/i)).toBeInTheDocument();
    expect(screen.getByText(/jane@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeEnabled();
  });

  it('calls logout and onSignedOut on success', async () => {
    let resolveLogout: () => void = () => {};
    mockLogout.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      })
    );
    const onSignedOut = vi.fn();
    render(<SignedInPanel email="jane@example.com" onSignedOut={onSignedOut} />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('button', { name: /signing out/i })).toBeDisabled();
    expect(mockLogout).toHaveBeenCalledTimes(1);

    resolveLogout();
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  });

  it('shows an error and stays signed in when logout fails', async () => {
    mockLogout.mockRejectedValueOnce(
      Object.assign(new Error('Network error while signing out.'), { kind: 'network' })
    );
    const onSignedOut = vi.fn();
    render(<SignedInPanel email="jane@example.com" onSignedOut={onSignedOut} />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error while signing out/i);
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeEnabled();
  });

  it('blocks double-clicks while signing out', async () => {
    let resolveLogout: () => void = () => {};
    mockLogout.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      })
    );
    render(<SignedInPanel email="jane@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    fireEvent.click(screen.getByRole('button', { name: /signing out/i }));
    expect(mockLogout).toHaveBeenCalledTimes(1);

    resolveLogout();
    expect(await screen.findByRole('button', { name: /^sign out$/i })).toBeEnabled();
  });

  it('toggles profile view mode with Edit Technical Profile button, opens editor, and cancels back to card view', async () => {
    vi.spyOn(authFetchModule, 'authFetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/profiles/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              profile: {
                handle: 'jane_coder',
                primaryRole: 'Frontend',
                institution: 'Centennial College',
                skills: ['React'],
                portfolioLinks: [{ url: 'https://github.com/jane_coder', label: 'GitHub' }],
                sharedContactHandle: '@jane_discord',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        );
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    render(<SignedInPanel email="jane@example.com" />);

    // Step 1: Click "Manage Technical Profile"
    fireEvent.click(screen.getByRole('button', { name: /manage technical profile/i }));

    // Step 2: Candidate card displays with "Edit Technical Profile" button
    expect(await screen.findByText('@jane_coder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit technical profile/i })).toBeInTheDocument();

    // Step 3: Click "Edit Technical Profile" -> enters editor mode
    fireEvent.click(screen.getByRole('button', { name: /edit technical profile/i }));
    expect(await screen.findByLabelText(/display handle/i)).toHaveValue('jane_coder');
    expect(screen.getByRole('button', { name: /save technical profile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    // Step 4: Click "Cancel" -> returns back to CandidateProfileCard view
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(await screen.findByText('@jane_coder')).toBeInTheDocument();
    expect(screen.queryByLabelText(/display handle/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit technical profile/i })).toBeInTheDocument();
  });
});
