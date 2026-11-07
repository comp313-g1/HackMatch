import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TeamManifestCard } from './TeamManifestCard';
import * as teamManifestApi from './teamManifestApi';
import * as teamManifestExport from './teamManifestExport';
import type { TeamManifestExportPayload } from './teamManifestExport';

describe('TeamManifestCard (US-024 / #226 / FR-071 / FR-072)', () => {
  const samplePayload: TeamManifestExportPayload = {
    teamId: '00000000-0000-0000-0000-000000000001',
    snapshot: {
      schemaVersion: '1.0',
      teamId: '00000000-0000-0000-0000-000000000001',
      teamName: 'Alpha Innovators',
      eventId: '11111111-1111-1111-1111-111111111111',
      eventTitle: 'Centennial Hackathon 2026',
      lockedAt: '2026-10-20T15:30:00.000Z',
      memberCount: 2,
      members: [
        {
          participantId: '22222222-2222-2222-2222-222222222222',
          displayName: 'Alice Chen',
          handle: 'alice_c',
          teamRole: 'Owner',
          primaryRole: 'Frontend',
          institution: 'Centennial College',
          portfolioLinks: [{ label: 'GitHub', url: 'https://github.com/alice' }],
          joinedAt: '2026-10-18T10:00:00.000Z',
          isPseudonymized: false,
        },
        {
          participantId: '33333333-3333-3333-3333-333333333333',
          displayName: 'Former Member 7b3e21a0',
          handle: null,
          teamRole: 'Member',
          primaryRole: null,
          institution: null,
          portfolioLinks: [],
          joinedAt: '2026-10-19T12:00:00.000Z',
          isPseudonymized: true,
        },
      ],
    },
    canonicalJson: '{"canonical":"representation"}',
    integrity: {
      algorithm: 'SHA-256',
      checksum: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      schemaVersion: '1.0',
      recordedByLabel: 'Lock time recorded by HackMatch server; SHA-256 checksum is for integrity comparison with the stored server record.',
      integrityNotice: 'This lock timestamp is recorded by HackMatch and the SHA-256 checksum is an integrity comparison with the stored server snapshot only.',
      privacyExclusionNotice: 'Account email addresses and private teammate contact handles are strictly excluded from roster exports.',
      organizerAcceptanceAssumed: false,
    },
    changeDetection: {
      matchesStoredSnapshot: true,
      previousChecksum: null,
      changedFields: [],
    },
    exportedAt: '2026-10-21T09:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders collapsed state when autoLoad is false without fetching manifest', () => {
    const fetchSpy = vi.spyOn(teamManifestApi, 'fetchTeamManifest');
    render(<TeamManifestCard teamId="00000000-0000-0000-0000-000000000001" autoLoad={false} />);

    expect(screen.getByTestId('open-team-manifest-btn')).toBeInTheDocument();
    expect(screen.getByText('Team Manifest & Check-In Verification Card')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches manifest when trigger button is clicked in collapsed state', async () => {
    vi.spyOn(teamManifestApi, 'fetchTeamManifest').mockResolvedValue(samplePayload);
    render(<TeamManifestCard teamId="00000000-0000-0000-0000-000000000001" autoLoad={false} />);

    fireEvent.click(screen.getByTestId('open-team-manifest-btn'));
    expect(await screen.findByTestId('team-verification-card')).toBeInTheDocument();
    expect(screen.getByTestId('manifest-team-name')).toHaveTextContent('Alpha Innovators');
  });

  it('renders verification card details, integrity notice, and roster table when autoLoad is true', async () => {
    vi.spyOn(teamManifestApi, 'fetchTeamManifest').mockResolvedValue(samplePayload);
    render(<TeamManifestCard teamId="00000000-0000-0000-0000-000000000001" autoLoad={true} />);

    expect(await screen.findByTestId('team-verification-card')).toBeInTheDocument();
    expect(screen.getByTestId('manifest-recorded-lock-time')).toHaveTextContent(/Lock time recorded by HackMatch/);
    expect(screen.getByTestId('manifest-checksum-value')).toHaveTextContent(samplePayload.integrity.checksum);
    expect(screen.getByTestId('manifest-integrity-disclaimer')).toHaveTextContent(/recorded by HackMatch/);
    expect(screen.getByTestId('manifest-privacy-notice')).toHaveTextContent(/Account email addresses and private/);

    // Members table
    expect(screen.getByText('Alice Chen')).toBeInTheDocument();
    expect(screen.getByText('@alice_c')).toBeInTheDocument();
    expect(screen.getByText('Centennial College')).toBeInTheDocument();
    expect(screen.getByText('Former Member 7b3e21a0')).toBeInTheDocument();
    expect(screen.getByTestId('pseudonymized-badge')).toBeInTheDocument();
  });

  it('triggers browser download for JSON, HTML, and PDF formats', async () => {
    vi.spyOn(teamManifestApi, 'fetchTeamManifest').mockResolvedValue(samplePayload);
    const downloadSpy = vi.spyOn(teamManifestExport, 'triggerBrowserDownload').mockImplementation(() => {});

    render(<TeamManifestCard teamId="00000000-0000-0000-0000-000000000001" autoLoad={true} />);
    expect(await screen.findByTestId('manifest-export-controls')).toBeInTheDocument();

    // Click JSON quick button
    fireEvent.click(screen.getByTestId('download-manifest-json-btn'));
    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalled();
    });

    // Click HTML quick button
    fireEvent.click(screen.getByTestId('download-manifest-html-btn'));
    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalledTimes(2);
    });

    // Click PDF quick button
    fireEvent.click(screen.getByTestId('download-manifest-pdf-btn'));
    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalledTimes(3);
    });
  });

  it('calls window.print when Print Card button is clicked', async () => {
    vi.spyOn(teamManifestApi, 'fetchTeamManifest').mockResolvedValue(samplePayload);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(<TeamManifestCard teamId="00000000-0000-0000-0000-000000000001" autoLoad={true} />);
    expect(await screen.findByTestId('print-manifest-card-btn')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('print-manifest-card-btn'));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('verifies matching checksum successfully against stored record', async () => {
    vi.spyOn(teamManifestApi, 'fetchTeamManifest').mockResolvedValue(samplePayload);
    vi.spyOn(teamManifestApi, 'verifyTeamManifestChecksum').mockResolvedValue({
      valid: true,
      expectedChecksum: samplePayload.integrity.checksum,
      providedChecksum: samplePayload.integrity.checksum,
      matchesStoredSnapshot: true,
      lockedAt: samplePayload.snapshot.lockedAt,
      message: 'Checksum matches.',
    });

    render(<TeamManifestCard teamId="00000000-0000-0000-0000-000000000001" autoLoad={true} />);
    expect(await screen.findByTestId('manifest-verify-form')).toBeInTheDocument();

    const input = screen.getByTestId('manifest-verify-input');
    fireEvent.change(input, { target: { value: samplePayload.integrity.checksum } });
    fireEvent.click(screen.getByTestId('manifest-verify-btn'));

    expect(await screen.findByTestId('manifest-verify-success')).toBeInTheDocument();
    expect(screen.getByTestId('manifest-verify-success')).toHaveTextContent(/Checksum matches the stored server record/);
  });

  it('displays validation error and preserves user-entered checksum input on error (NR-010)', async () => {
    vi.spyOn(teamManifestApi, 'fetchTeamManifest').mockResolvedValue(samplePayload);

    render(<TeamManifestCard teamId="00000000-0000-0000-0000-000000000001" autoLoad={true} />);
    expect(await screen.findByTestId('manifest-verify-form')).toBeInTheDocument();

    const input = screen.getByTestId('manifest-verify-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not-a-valid-checksum' } });
    fireEvent.click(screen.getByTestId('manifest-verify-btn'));

    expect(await screen.findByTestId('manifest-verify-error')).toBeInTheDocument();
    expect(screen.getByTestId('manifest-verify-error')).toHaveTextContent(/valid 64-character SHA-256/);
    // Preserves input on error (NR-010)
    expect(input.value).toBe('not-a-valid-checksum');
  });

  it('renders error state with reload button when manifest fetch fails', async () => {
    vi.spyOn(teamManifestApi, 'fetchTeamManifest').mockRejectedValue(
      new teamManifestApi.TeamManifestApiError(403, 'MANIFEST_ACCESS_DENIED', undefined, undefined, 'Access denied to team manifest.')
    );

    render(<TeamManifestCard teamId="00000000-0000-0000-0000-000000000001" autoLoad={true} />);

    expect(await screen.findByTestId('manifest-error')).toBeInTheDocument();
    expect(screen.getByTestId('manifest-error')).toHaveTextContent('Access denied to team manifest.');
    expect(screen.getByTestId('reload-manifest-btn')).toBeInTheDocument();
  });
});
