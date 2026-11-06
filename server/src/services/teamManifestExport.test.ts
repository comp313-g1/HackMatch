import { describe, it, expect } from 'vitest';
import {
  escapeManifestHtml,
  escapePdfString,
  formatManifestAsJson,
  renderPrintableManifestHtml,
  buildDeterministicManifestPdf,
  buildManifestExportArtifact,
  type TeamManifestExportPayload,
} from './teamManifestExport.js';
import {
  MANIFEST_RECORDED_BY_LABEL,
  MANIFEST_INTEGRITY_NOTICE,
  MANIFEST_PRIVACY_EXCLUSION_NOTICE,
} from '../db/teamManifestModel.js';

describe('teamManifestExport service (US-024 / #224 / FR-071)', () => {
  const samplePayload: TeamManifestExportPayload = {
    teamId: '00000000-0000-0000-0000-000000000001',
    snapshot: {
      schemaVersion: '1.0',
      teamId: '00000000-0000-0000-0000-000000000001',
      teamName: 'Alpha Innovators <script>alert("xss")</script>',
      eventId: '11111111-1111-1111-1111-111111111111',
      eventTitle: 'Centennial Hackathon 2026 & Beyond',
      lockedAt: '2026-10-20T15:30:00.000Z',
      memberCount: 2,
      members: [
        {
          participantId: '22222222-2222-2222-2222-222222222222',
          displayName: 'Alice "Hacker" Chen',
          handle: 'alice_c',
          teamRole: 'Owner',
          primaryRole: 'Frontend',
          institution: 'Centennial College & Friends',
          portfolioLinks: [
            { label: 'GitHub Profile', url: 'https://github.com/alice' },
            { label: null, url: 'https://alice.dev' },
          ],
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
      recordedByLabel: MANIFEST_RECORDED_BY_LABEL,
      integrityNotice: MANIFEST_INTEGRITY_NOTICE,
      privacyExclusionNotice: MANIFEST_PRIVACY_EXCLUSION_NOTICE,
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
      const input = `<script>alert("hello & 'world'")</script>`;
      const escaped = escapeManifestHtml(input);
      expect(escaped).toBe('&lt;script&gt;alert(&quot;hello &amp; &#39;world&#39;&quot;)&lt;/script&gt;');
    });

    it('returns empty string unmodified', () => {
      expect(escapeManifestHtml('')).toBe('');
    });
  });

  describe('escapePdfString', () => {
    it('escapes backslashes and parentheses', () => {
      const input = 'Path: C:\\dir\\file (draft)';
      expect(escapePdfString(input)).toBe('Path: C:\\\\dir\\\\file \\(draft\\)');
    });

    it('replaces newlines, returns, and tabs with spaces', () => {
      const input = "Line 1\r\nLine 2\tEnd";
      expect(escapePdfString(input)).toBe('Line 1  Line 2 End');
    });

    it('replaces non-ASCII characters with question marks', () => {
      const input = 'Café & Résumé — 100%';
      expect(escapePdfString(input)).toBe('Caf? & R?sum? ? 100%');
    });
  });

  describe('formatManifestAsJson', () => {
    it('serializes complete export payload with indentation', () => {
      const json = formatManifestAsJson(samplePayload);
      const parsed = JSON.parse(json);
      expect(parsed.teamId).toBe(samplePayload.teamId);
      expect(parsed.snapshot.teamName).toBe(samplePayload.snapshot.teamName);
      expect(parsed.integrity.checksum).toBe(samplePayload.integrity.checksum);
      expect(parsed.integrity.organizerAcceptanceAssumed).toBe(false);
      expect(parsed.changeDetection.matchesStoredSnapshot).toBe(true);
    });
  });

  describe('renderPrintableManifestHtml', () => {
    it('produces valid HTML5 document with security escaping and media print styling', () => {
      const html = renderPrintableManifestHtml(samplePayload);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('@media print');

      // Escaping check
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain('Alice &quot;Hacker&quot; Chen');

      // Required notices & checksum
      expect(html).toContain('Lock time recorded by HackMatch');
      expect(html).toContain('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(html).toContain(MANIFEST_INTEGRITY_NOTICE);
      expect(html).toContain(MANIFEST_PRIVACY_EXCLUSION_NOTICE);

      // Members table
      expect(html).toContain('@alice_c');
      expect(html).toContain('badge-owner');
      expect(html).toContain('badge-pseudonym');
      expect(html).toContain('Former Member 7b3e21a0');
      expect(html).toContain('https://github.com/alice');
    });
  });

  describe('buildDeterministicManifestPdf', () => {
    it('produces valid PDF-1.4 binary buffer with header, objects, xref, and trailer', () => {
      const pdfBuffer = buildDeterministicManifestPdf(samplePayload);
      expect(ArrayBuffer.isView(pdfBuffer)).toBe(true);

      const pdfString = Buffer.from(pdfBuffer).toString('utf-8');
      expect(pdfString.startsWith('%PDF-1.4\n')).toBe(true);
      expect(pdfString.trimEnd().endsWith('%%EOF')).toBe(true);

      // PDF structural objects
      expect(pdfString).toContain('/Type /Catalog');
      expect(pdfString).toContain('/Type /Pages');
      expect(pdfString).toContain('/Type /Page');
      expect(pdfString).toContain('/BaseFont /Helvetica');
      expect(pdfString).toContain('/BaseFont /Helvetica-Bold');
      expect(pdfString).toContain('xref\n0 7');
      expect(pdfString).toContain('trailer');

      // Included fields & disclaimers in PDF stream
      expect(pdfString).toContain('Alpha Innovators');
      expect(pdfString).toContain('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(pdfString).toContain('Lock time recorded by HackMatch:');
      expect(pdfString).toContain('Alice');
      expect(pdfString).toContain('Former Member 7b3e21a0');
    });
  });

  describe('buildManifestExportArtifact', () => {
    it('builds JSON artifact', () => {
      const artifact = buildManifestExportArtifact(samplePayload, 'json');
      expect(artifact.format).toBe('json');
      expect(artifact.filename).toBe(`team-manifest-${samplePayload.teamId}.json`);
      expect(artifact.contentType).toBe('application/json; charset=utf-8');
      expect(typeof artifact.content).toBe('string');
      expect(artifact.content).toContain(samplePayload.integrity.checksum);
    });

    it('builds HTML artifact', () => {
      const artifact = buildManifestExportArtifact(samplePayload, 'html');
      expect(artifact.format).toBe('html');
      expect(artifact.filename).toBe(`team-verification-card-${samplePayload.teamId}.html`);
      expect(artifact.contentType).toBe('text/html; charset=utf-8');
      expect(typeof artifact.content).toBe('string');
      expect(artifact.content).toContain('<!DOCTYPE html>');
    });

    it('builds PDF artifact', () => {
      const artifact = buildManifestExportArtifact(samplePayload, 'pdf');
      expect(artifact.format).toBe('pdf');
      expect(artifact.filename).toBe(`team-verification-card-${samplePayload.teamId}.pdf`);
      expect(artifact.contentType).toBe('application/pdf');
      expect(ArrayBuffer.isView(artifact.content)).toBe(true);
      expect(Buffer.from(artifact.content as Uint8Array).toString('utf-8').startsWith('%PDF-1.4')).toBe(true);
    });
  });
});
