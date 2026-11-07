import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeManifestHtml,
  escapePdfString,
  formatManifestAsJson,
  renderPrintableManifestHtml,
  buildDeterministicManifestPdf,
  buildManifestDownloadArtifact,
  triggerBrowserDownload,
  type TeamManifestExportPayload,
} from './teamManifestExport';

describe('client teamManifestExport (US-024 / #224 / FR-071)', () => {
  const samplePayload: TeamManifestExportPayload = {
    teamId: '00000000-0000-0000-0000-000000000001',
    snapshot: {
      schemaVersion: '1.0',
      teamId: '00000000-0000-0000-0000-000000000001',
      teamName: 'Beta Innovators <img src=x onerror=alert(1)>',
      eventId: '11111111-1111-1111-1111-111111111111',
      eventTitle: 'Hackathon 2026',
      lockedAt: '2026-10-20T15:30:00.000Z',
      memberCount: 2,
      members: [
        {
          participantId: '22222222-2222-2222-2222-222222222222',
          displayName: 'Bob "Coder" Smith',
          handle: 'bob_s',
          teamRole: 'Owner',
          primaryRole: 'Backend',
          institution: 'Centennial College',
          portfolioLinks: [
            { label: 'GitHub', url: 'https://github.com/bob' },
          ],
          joinedAt: '2026-10-18T10:00:00.000Z',
          isPseudonymized: false,
        },
        {
          participantId: '33333333-3333-3333-3333-333333333333',
          displayName: 'Former Member deadbeef',
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
    canonicalJson: '{"canonical":"client"}',
    integrity: {
      algorithm: 'SHA-256',
      checksum: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
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

  describe('escapeManifestHtml', () => {
    it('escapes &, <, >, ", and single quotes', () => {
      const input = `<b onmouseover="alert('xss')">Team & Co</b>`;
      const escaped = escapeManifestHtml(input);
      expect(escaped).toBe('&lt;b onmouseover=&quot;alert(&#39;xss&#39;)&quot;&gt;Team &amp; Co&lt;/b&gt;');
    });
  });

  describe('escapePdfString', () => {
    it('escapes parentheses and backslashes', () => {
      expect(escapePdfString('(Test) \\ Value')).toBe('\\(Test\\) \\\\ Value');
    });

    it('cleans control characters and non-ASCII characters', () => {
      expect(escapePdfString("Alpha\tBeta\r\nGamma — 99%")).toBe('Alpha Beta  Gamma ? 99%');
    });
  });

  describe('formatManifestAsJson', () => {
    it('serializes complete export payload', () => {
      const json = formatManifestAsJson(samplePayload);
      const parsed = JSON.parse(json);
      expect(parsed.teamId).toBe(samplePayload.teamId);
      expect(parsed.snapshot.teamName).toBe(samplePayload.snapshot.teamName);
      expect(parsed.integrity.organizerAcceptanceAssumed).toBe(false);
    });
  });

  describe('renderPrintableManifestHtml', () => {
    it('produces valid HTML with escaped text, badges, and print CSS', () => {
      const html = renderPrintableManifestHtml(samplePayload);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('@media print');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('Bob &quot;Coder&quot; Smith');
      expect(html).toContain('badge-pseudonym');
      expect(html).toContain('Lock time recorded by HackMatch');
      expect(html).toContain('sha256:1234567890abcdef');
    });
  });

  describe('buildDeterministicManifestPdf', () => {
    it('returns a Uint8Array representing valid PDF-1.4 format', () => {
      const pdfBytes = buildDeterministicManifestPdf(samplePayload);
      expect(ArrayBuffer.isView(pdfBytes)).toBe(true);
      expect(pdfBytes.byteLength).toBeGreaterThan(0);

      const decoder = new TextDecoder('utf-8');
      const pdfString = decoder.decode(pdfBytes);
      expect(pdfString.startsWith('%PDF-1.4\n')).toBe(true);
      expect(pdfString.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(pdfString).toContain('/Type /Catalog');
      expect(pdfString).toContain('/Type /Pages');
      expect(pdfString).toContain('Beta Innovators');
      expect(pdfString).toContain('Former Member deadbeef');
    });
  });

  describe('buildManifestDownloadArtifact', () => {
    it('returns JSON download artifact', () => {
      const artifact = buildManifestDownloadArtifact(samplePayload, 'json');
      expect(artifact.format).toBe('json');
      expect(artifact.filename).toBe(`team-manifest-${samplePayload.teamId}.json`);
      expect(artifact.contentType).toBe('application/json; charset=utf-8');
    });

    it('returns HTML download artifact', () => {
      const artifact = buildManifestDownloadArtifact(samplePayload, 'html');
      expect(artifact.format).toBe('html');
      expect(artifact.filename).toBe(`team-verification-card-${samplePayload.teamId}.html`);
      expect(artifact.contentType).toBe('text/html; charset=utf-8');
    });

    it('returns PDF download artifact', () => {
      const artifact = buildManifestDownloadArtifact(samplePayload, 'pdf');
      expect(artifact.format).toBe('pdf');
      expect(artifact.filename).toBe(`team-verification-card-${samplePayload.teamId}.pdf`);
      expect(artifact.contentType).toBe('application/pdf');
    });
  });

  describe('triggerBrowserDownload', () => {
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
      originalCreateObjectURL = URL.createObjectURL;
      originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/dummy-uuid');
      URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      vi.restoreAllMocks();
    });

    it('creates temporary anchor, triggers click, and revokes object URL for string content', () => {
      const artifact = buildManifestDownloadArtifact(samplePayload, 'json');
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      triggerBrowserDownload(artifact);

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/dummy-uuid');
    });

    it('handles binary Uint8Array content (PDF)', () => {
      const artifact = buildManifestDownloadArtifact(samplePayload, 'pdf');
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      triggerBrowserDownload(artifact);

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/dummy-uuid');
    });
  });
});
