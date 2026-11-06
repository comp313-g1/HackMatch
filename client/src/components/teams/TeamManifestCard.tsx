import React, { useState, useEffect, useCallback } from 'react';
import type { TeamView } from './teamTypes';
import {
  type ManifestExportFormat,
  type TeamManifestExportPayload,
  buildManifestDownloadArtifact,
  triggerBrowserDownload,
} from './teamManifestExport';
import {
  validateChecksumInput,
  verifyClientSnapshotChecksum,
} from './teamManifestChecksum';
import {
  fetchTeamManifest,
  verifyTeamManifestChecksum,
  downloadTeamManifestFromServer,
  TeamManifestApiError,
} from './teamManifestApi';

export interface TeamManifestCardProps {
  teamId: string;
  team?: TeamView | null;
  autoLoad?: boolean;
}

export function TeamManifestCard({
  teamId,
  autoLoad = true,
}: TeamManifestCardProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(autoLoad);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<TeamManifestExportPayload | null>(null);

  // Export controls state
  const [selectedFormat, setSelectedFormat] = useState<ManifestExportFormat>('json');
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  // Checksum verification state
  const [verifyInput, setVerifyInput] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<{
    type: 'success' | 'mismatch' | 'error';
    message: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const loadManifest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDownloadStatus(null);
    setVerifyStatus(null);

    try {
      const data = await fetchTeamManifest(teamId);
      setPayload(data);
    } catch (err: unknown) {
      if (err instanceof TeamManifestApiError) {
        setError(err.message || 'Failed to load team manifest.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while loading the manifest.');
      }
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (isOpen && !payload && !loading && !error) {
      void loadManifest();
    }
  }, [isOpen, payload, loading, error, loadManifest]);

  const handleDownload = async (format: ManifestExportFormat) => {
    if (!payload) return;
    setDownloading(true);
    setDownloadStatus(`Preparing ${format.toUpperCase()} export…`);

    try {
      // First attempt server-generated downloadable artifact; fallback to client generator
      try {
        const artifact = await downloadTeamManifestFromServer(teamId, format);
        triggerBrowserDownload(artifact);
        setDownloadStatus(`Exported ${artifact.filename} successfully.`);
      } catch {
        const clientArtifact = buildManifestDownloadArtifact(payload, format);
        triggerBrowserDownload(clientArtifact);
        setDownloadStatus(`Exported ${clientArtifact.filename} successfully.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      setDownloadStatus(`Export failed: ${msg}`);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  };

  const handleCopyChecksum = async () => {
    if (!payload?.integrity?.checksum) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload.integrity.checksum);
        setDownloadStatus('Checksum copied to clipboard.');
      }
    } catch {
      setDownloadStatus(`Checksum: ${payload.integrity.checksum}`);
    }
  };

  const handleVerifyChecksum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload) return;

    // Client-side validation: preserves verifyInput on error (NR-010)
    const validation = validateChecksumInput(verifyInput);
    if (!validation.valid) {
      setVerifyStatus({
        type: 'error',
        message: validation.error || 'Invalid checksum format.',
      });
      return;
    }

    setVerifying(true);
    setVerifyStatus(null);

    try {
      // Try server verify endpoint first
      try {
        const apiRes = await verifyTeamManifestChecksum(teamId, verifyInput);
        if (apiRes.matchesStoredSnapshot) {
          setVerifyStatus({
            type: 'success',
            message: `Checksum matches the stored server record (locked at ${new Date(apiRes.lockedAt).toLocaleString()}).`,
          });
        } else {
          setVerifyStatus({
            type: 'mismatch',
            message: `Checksum does not match the stored server record. Stored: ${apiRes.expectedChecksum}.`,
          });
        }
      } catch {
        // Client fallback verification
        const clientRes = verifyClientSnapshotChecksum(payload.snapshot, verifyInput);
        if (clientRes.matchesStoredSnapshot) {
          setVerifyStatus({
            type: 'success',
            message: 'Checksum matches the canonical roster snapshot integrity check.',
          });
        } else {
          setVerifyStatus({
            type: 'mismatch',
            message: `Checksum does not match the canonical snapshot. Expected: ${clientRes.expectedChecksum}.`,
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed.';
      setVerifyStatus({
        type: 'error',
        message: msg,
      });
    } finally {
      setVerifying(false);
    }
  };

  // 1. Collapsed Trigger State
  if (!isOpen) {
    return (
      <div
        data-testid="team-manifest-card"
        className="bg-white rounded-lg border border-cream-200 p-6 shadow-sm space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-ink-900">
              Team Manifest & Check-In Verification Card
            </h3>
            <p className="text-sm text-ink-600 mt-1">
              Export canonical roster record in JSON, HTML, or PDF with SHA-256 integrity verification.
            </p>
          </div>
          <button
            type="button"
            data-testid="open-team-manifest-btn"
            onClick={() => setIsOpen(true)}
            className="px-4 py-2 bg-forest-700 hover:bg-forest-800 text-white text-sm font-medium rounded-md transition focus:outline-none focus:ring-2 focus:ring-forest-500 whitespace-nowrap"
          >
            Open Team Manifest & Check-In Card
          </button>
        </div>
      </div>
    );
  }

  // 2. Loading State
  if (loading) {
    return (
      <div
        data-testid="team-manifest-card"
        className="bg-white rounded-lg border border-cream-200 p-6 shadow-sm space-y-4"
      >
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-testid="manifest-loading"
          className="flex items-center gap-3 text-ink-600 text-sm"
        >
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-forest-600 border-t-transparent" />
          <span>Loading locked team manifest…</span>
        </div>
      </div>
    );
  }

  // 3. Error State
  if (error || !payload) {
    return (
      <div
        data-testid="team-manifest-card"
        className="bg-white rounded-lg border border-cream-200 p-6 shadow-sm space-y-4"
      >
        <div
          role="alert"
          aria-live="assertive"
          data-testid="manifest-error"
          className="p-4 bg-red-50 border border-red-200 text-red-900 text-sm rounded-md space-y-2"
        >
          <p className="font-semibold">Manifest Export Unavailable</p>
          <p>{error || 'Unable to load manifest snapshot.'}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="reload-manifest-btn"
            onClick={() => void loadManifest()}
            className="px-4 py-2 bg-cream-100 hover:bg-cream-200 text-ink-900 border border-cream-300 text-sm font-medium rounded-md transition focus:outline-none focus:ring-2 focus:ring-forest-500"
          >
            Reload Manifest
          </button>
        </div>
      </div>
    );
  }

  const { snapshot, integrity } = payload;
  const formattedLockTime = new Date(snapshot.lockedAt).toLocaleString();

  return (
    <div
      data-testid="team-manifest-card"
      className="bg-white rounded-lg border border-cream-200 p-6 shadow-sm space-y-6 print:border-none print:shadow-none print:p-0"
    >
      {/* Header and Verification Metadata (US-024 / FR-071 / FR-072) */}
      <div
        data-testid="team-verification-card"
        className="border-b border-cream-200 pb-5 space-y-3 print:border-ink"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-xs font-semibold tracking-wider uppercase text-forest-700 bg-forest-50 px-2 py-0.5 rounded border border-forest-200">
              Check-In Verification Card
            </span>
            <h3
              data-testid="manifest-team-name"
              className="text-lg font-bold text-ink-900 mt-1"
            >
              {snapshot.teamName}
            </h3>
            <p
              data-testid="manifest-event-title"
              className="text-sm text-ink-600"
            >
              Event: {snapshot.eventTitle} · {snapshot.memberCount} Confirmed Members
            </p>
          </div>
        </div>

        {/* Timestamp recorded by HackMatch */}
        <div
          data-testid="manifest-recorded-lock-time"
          className="text-sm font-medium text-ink-800 bg-cream-50 p-3 rounded border border-cream-200"
        >
          Lock time recorded by HackMatch: {formattedLockTime} (UTC ISO: {snapshot.lockedAt})
        </div>

        {/* SHA-256 Checksum */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-amber-50/70 p-3 rounded border border-amber-200">
          <div className="font-mono text-xs text-amber-950 break-all">
            <span className="font-sans font-semibold text-amber-900 mr-1">
              SHA-256 Integrity Checksum:
            </span>
            <span data-testid="manifest-checksum-value">{integrity.checksum}</span>
          </div>
          <button
            type="button"
            data-testid="copy-checksum-btn"
            onClick={() => void handleCopyChecksum()}
            className="px-2.5 py-1 bg-white hover:bg-amber-100 text-amber-900 text-xs font-medium border border-amber-300 rounded shadow-2xs whitespace-nowrap self-start sm:self-auto"
          >
            Copy Checksum
          </button>
        </div>

        {/* Disclaimers & Privacy Notice (US-024 AC 2, 4) */}
        <div className="space-y-1.5 text-xs text-ink-600 pt-1">
          <p
            data-testid="manifest-integrity-disclaimer"
            className="text-ink-700 italic"
          >
            {integrity.integrityNotice ||
              'This lock timestamp is recorded by HackMatch and the SHA-256 checksum is an integrity comparison with the stored server snapshot only. It does not independently prove pre-event team formation, legal eligibility, or official event organizer approval/acceptance.'}
          </p>
          <p
            data-testid="manifest-privacy-notice"
            className="font-medium text-forest-800"
          >
            {integrity.privacyExclusionNotice ||
              'Account email addresses and private teammate contact handles are strictly excluded from roster exports.'}
          </p>
        </div>
      </div>

      {/* Confirmed Locked Roster Members Table */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-ink-900 uppercase tracking-wide">
          Confirmed Locked Roster
        </h4>
        <div className="overflow-x-auto border border-cream-200 rounded-md">
          <table
            data-testid="manifest-members-list"
            className="min-w-full divide-y divide-cream-200 text-sm text-left"
          >
            <thead className="bg-cream-100 text-xs font-semibold text-ink-700 uppercase">
              <tr>
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Primary Role</th>
                <th className="px-4 py-2.5">Institution</th>
                <th className="px-4 py-2.5">Portfolio Links</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-100 bg-white">
              {snapshot.members.map((member) => (
                <tr key={member.participantId} className="hover:bg-cream-50/50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink-900 flex items-center gap-1.5">
                      <span>{member.displayName}</span>
                      {member.isPseudonymized && (
                        <span
                          data-testid="pseudonymized-badge"
                          className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-xs rounded"
                        >
                          Pseudonymized
                        </span>
                      )}
                    </div>
                    {member.handle && (
                      <div className="text-xs text-ink-500 font-mono">@{member.handle}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        member.teamRole === 'Owner'
                          ? 'bg-forest-100 text-forest-800 font-semibold'
                          : 'bg-cream-200 text-ink-700'
                      }`}
                    >
                      {member.teamRole}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {member.primaryRole || <span className="text-ink-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-700">
                    {member.institution || <span className="text-ink-400">Not specified</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {member.portfolioLinks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {member.portfolioLinks.map((link) => (
                          <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-forest-700 hover:text-forest-900 underline"
                          >
                            {link.label || link.url}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-ink-400">None listed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Controls & Action Buttons (US-024 / FR-071) */}
      <div
        data-testid="manifest-export-controls"
        className="pt-2 border-t border-cream-200 space-y-4 print:hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <label
              htmlFor="manifest-export-format"
              className="text-xs font-semibold text-ink-700 uppercase"
            >
              Format:
            </label>
            <select
              id="manifest-export-format"
              data-testid="manifest-format-select"
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value as ManifestExportFormat)}
              disabled={downloading}
              className="px-3 py-1.5 border border-cream-300 rounded-md text-sm text-ink-900 bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
            >
              <option value="json">JSON Manifest (.json)</option>
              <option value="html">Printable HTML Card (.html)</option>
              <option value="pdf">Verification PDF (.pdf)</option>
            </select>
            <button
              type="button"
              data-testid="export-selected-btn"
              disabled={downloading}
              onClick={() => void handleDownload(selectedFormat)}
              className="px-3 py-1.5 bg-forest-700 hover:bg-forest-800 disabled:opacity-50 text-white text-sm font-medium rounded-md transition focus:outline-none focus:ring-2 focus:ring-forest-500"
            >
              Export Selected
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="download-manifest-json-btn"
              disabled={downloading}
              onClick={() => void handleDownload('json')}
              className="px-2.5 py-1.5 bg-cream-100 hover:bg-cream-200 text-ink-800 border border-cream-300 text-xs font-medium rounded-md transition"
            >
              JSON
            </button>
            <button
              type="button"
              data-testid="download-manifest-html-btn"
              disabled={downloading}
              onClick={() => void handleDownload('html')}
              className="px-2.5 py-1.5 bg-cream-100 hover:bg-cream-200 text-ink-800 border border-cream-300 text-xs font-medium rounded-md transition"
            >
              HTML
            </button>
            <button
              type="button"
              data-testid="download-manifest-pdf-btn"
              disabled={downloading}
              onClick={() => void handleDownload('pdf')}
              className="px-2.5 py-1.5 bg-cream-100 hover:bg-cream-200 text-ink-800 border border-cream-300 text-xs font-medium rounded-md transition"
            >
              PDF
            </button>
            <button
              type="button"
              data-testid="print-manifest-card-btn"
              onClick={handlePrint}
              className="px-2.5 py-1.5 bg-cream-200 hover:bg-cream-300 text-ink-900 border border-cream-400 text-xs font-medium rounded-md transition"
            >
              Print Card
            </button>
          </div>
        </div>

        {downloadStatus && (
          <div
            role="status"
            aria-live="polite"
            data-testid="manifest-download-status"
            className="text-xs text-forest-800 bg-forest-50 p-2.5 rounded border border-forest-200"
          >
            {downloadStatus}
          </div>
        )}
      </div>

      {/* Checksum Integrity Comparison Form (US-024 / FR-072 / NR-010) */}
      <div
        data-testid="manifest-verify-form"
        className="pt-2 border-t border-cream-200 space-y-3 print:hidden"
      >
        <h4 className="text-xs font-semibold text-ink-700 uppercase tracking-wide">
          Compare Checksum Against Server Record
        </h4>
        <form onSubmit={(e) => void handleVerifyChecksum(e)} className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <label htmlFor="manifest-verify-checksum-input" className="sr-only">
              Candidate SHA-256 Checksum
            </label>
            <input
              id="manifest-verify-checksum-input"
              data-testid="manifest-verify-input"
              type="text"
              placeholder="Paste SHA-256 checksum (e.g. sha256:... or 64 hex characters)"
              value={verifyInput}
              onChange={(e) => setVerifyInput(e.target.value)}
              disabled={verifying}
              className="flex-1 px-3 py-1.5 border border-cream-300 rounded-md text-xs font-mono text-ink-900 bg-white focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
            <button
              type="submit"
              data-testid="manifest-verify-btn"
              disabled={verifying}
              className="px-4 py-1.5 bg-forest-700 hover:bg-forest-800 disabled:opacity-50 text-white text-xs font-medium rounded-md transition focus:outline-none focus:ring-2 focus:ring-forest-500 whitespace-nowrap"
            >
              {verifying ? 'Verifying…' : 'Verify Checksum'}
            </button>
          </div>

          {verifyStatus?.type === 'success' && (
            <div
              role="status"
              aria-live="polite"
              data-testid="manifest-verify-success"
              className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-md"
            >
              {verifyStatus.message}
            </div>
          )}

          {(verifyStatus?.type === 'mismatch' || verifyStatus?.type === 'error') && (
            <div
              role="alert"
              aria-live="assertive"
              data-testid="manifest-verify-error"
              className="p-2.5 bg-red-50 border border-red-200 text-red-900 text-xs rounded-md"
            >
              {verifyStatus.message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
