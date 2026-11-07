import type { CanonicalRosterSnapshot } from '../db/types.js';
import { scrubManifestPrivateFields } from './manifestPrivacy.js';

export type ManifestExportFormat = 'json' | 'html' | 'pdf';

export interface ManifestIntegrityMetadata {
  algorithm: 'SHA-256';
  checksum: string;
  schemaVersion: '1.0';
  recordedByLabel: string;
  integrityNotice: string;
  privacyExclusionNotice: string;
  organizerAcceptanceAssumed: false;
}

export interface TeamManifestExportPayload {
  teamId: string;
  snapshot: CanonicalRosterSnapshot;
  canonicalJson: string;
  integrity: ManifestIntegrityMetadata;
  changeDetection: {
    matchesStoredSnapshot: boolean;
    previousChecksum: string | null;
    changedFields: string[];
  };
  exportedAt: string;
}

export interface ManifestExportArtifact {
  format: ManifestExportFormat;
  filename: string;
  contentType: string;
  content: string | Uint8Array;
}

export function escapeManifestHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapePdfString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?');
}

/**
 * Generates formatted JSON with manifest snapshot and integrity metadata (US-024 / FR-071).
 */
export function formatManifestAsJson(payload: TeamManifestExportPayload): string {
  const scrubbed = scrubManifestPrivateFields(payload);
  return JSON.stringify(scrubbed, null, 2);
}

/**
 * Generates an accessible, printable HTML verification card with print media styles (US-024 / FR-071).
 */
export function renderPrintableManifestHtml(payload: TeamManifestExportPayload): string {
  const scrubbed = scrubManifestPrivateFields(payload);
  const { snapshot, integrity, exportedAt } = scrubbed;
  const escapedTeamName = escapeManifestHtml(snapshot.teamName);
  const escapedEventTitle = escapeManifestHtml(snapshot.eventTitle);
  const formattedLockTime = new Date(snapshot.lockedAt).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

  const memberRows = snapshot.members
    .map((member) => {
      const escapedName = escapeManifestHtml(member.displayName);
      const escapedRole = escapeManifestHtml(member.teamRole);
      const escapedPrimaryRole = member.primaryRole
        ? escapeManifestHtml(member.primaryRole)
        : '<span class="text-muted">Unspecified</span>';
      const escapedHandle = member.handle
        ? `@${escapeManifestHtml(member.handle)}`
        : '<span class="text-muted">—</span>';
      const escapedInstitution = member.institution
        ? escapeManifestHtml(member.institution)
        : '<span class="text-muted">Not specified</span>';

      const portfolioLinksHtml =
        member.portfolioLinks.length > 0
          ? member.portfolioLinks
              .map((link) => {
                const label = link.label
                  ? escapeManifestHtml(link.label)
                  : escapeManifestHtml(link.url);
                const safeUrl = escapeManifestHtml(link.url);
                return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
              })
              .join(', ')
          : '<span class="text-muted">None listed</span>';

      return `
        <tr>
          <td>
            <strong>${escapedName}</strong>
            ${member.isPseudonymized ? '<span class="badge badge-pseudonym">Pseudonymized</span>' : ''}
          </td>
          <td>${escapedHandle}</td>
          <td><span class="badge ${member.teamRole === 'Owner' ? 'badge-owner' : 'badge-member'}">${escapedRole}</span></td>
          <td>${escapedPrimaryRole}</td>
          <td>${escapedInstitution}</td>
          <td>${portfolioLinksHtml}</td>
        </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Team Verification Card - ${escapedTeamName}</title>
  <style>
    :root {
      --color-forest: #1b4332;
      --color-ink: #1f2937;
      --color-ink-muted: #4b5563;
      --color-cream: #f9f6f0;
      --color-amber-bg: #fffbeb;
      --color-amber-border: #fcd34d;
      --color-amber-text: #78350f;
      --font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-family);
      background: #f3f4f6;
      color: var(--color-ink);
      padding: 24px;
      line-height: 1.5;
    }
    .card {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .header {
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 24px;
      color: var(--color-forest);
      margin-bottom: 4px;
    }
    .header .subtitle {
      font-size: 14px;
      color: var(--color-ink-muted);
    }
    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
      background: #f9fafb;
      padding: 16px;
      border-radius: 8px;
    }
    .meta-item dt {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      color: var(--color-ink-muted);
      letter-spacing: 0.05em;
    }
    .meta-item dd {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-ink);
      margin-top: 2px;
      word-break: break-all;
    }
    .checksum-box {
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 24px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      color: #0f172a;
      word-break: break-all;
    }
    .checksum-label {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--color-ink-muted);
      font-family: var(--font-family);
      margin-bottom: 4px;
    }
    .notice-box {
      background: var(--color-amber-bg);
      border: 1px solid var(--color-amber-border);
      color: var(--color-amber-text);
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 24px;
    }
    .privacy-notice {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e3a8a;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-bottom: 24px;
    }
    th {
      text-align: left;
      padding: 10px 12px;
      background: #f9fafb;
      border-bottom: 2px solid #e5e7eb;
      font-size: 11px;
      text-transform: uppercase;
      color: var(--color-ink-muted);
      letter-spacing: 0.05em;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
    }
    a {
      color: var(--color-forest);
      text-decoration: underline;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 4px;
    }
    .badge-owner { background: #dcfce7; color: #14532d; }
    .badge-member { background: #f3f4f6; color: #374151; }
    .badge-pseudonym { background: #fef2f2; color: #991b1b; margin-left: 6px; }
    .text-muted { color: #9ca3af; }
    .footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 16px;
      font-size: 11px;
      color: var(--color-ink-muted);
      text-align: center;
    }
    @media print {
      body { background: #ffffff; padding: 0; color: #000000; }
      .card { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      a { text-decoration: none; color: #000000; }
      th { background: #f0f0f0 !important; color: #000000; }
      .notice-box, .privacy-notice { border: 1px solid #000000; color: #000000; background: none; }
      .badge-owner, .badge-member { border: 1px solid #666; background: none; color: #000000; }
    }
  </style>
</head>
<body>
  <div class="card" data-testid="printable-manifest-card">
    <div class="header">
      <h1 data-testid="printable-team-name">${escapedTeamName}</h1>
      <div class="subtitle" data-testid="printable-event-title">Event: ${escapedEventTitle}</div>
    </div>

    <div class="metadata-grid">
      <div class="meta-item">
        <dt>Server Lock Time</dt>
        <dd data-testid="printable-lock-time">${formattedLockTime} UTC</dd>
      </div>
      <div class="meta-item">
        <dt>Team Identifier</dt>
        <dd>${escapeManifestHtml(snapshot.teamId)}</dd>
      </div>
      <div class="meta-item">
        <dt>Confirmed Members</dt>
        <dd>${snapshot.memberCount}</dd>
      </div>
      <div class="meta-item">
        <dt>Manifest Schema</dt>
        <dd>v${escapeManifestHtml(snapshot.schemaVersion)}</dd>
      </div>
    </div>

    <div class="checksum-box">
      <div class="checksum-label">Integrity Checksum (SHA-256 comparison with server snapshot)</div>
      <div data-testid="printable-checksum">${escapeManifestHtml(integrity.checksum)}</div>
    </div>

    <div class="notice-box" data-testid="printable-integrity-notice">
      <strong>Verification Note:</strong> ${escapeManifestHtml(integrity.integrityNotice)}
    </div>

    <div class="privacy-notice" data-testid="printable-privacy-notice">
      <strong>Privacy Protection:</strong> ${escapeManifestHtml(integrity.privacyExclusionNotice)}
    </div>

    <h3>Confirmed Team Roster</h3>
    <table data-testid="printable-members-table">
      <thead>
        <tr>
          <th>Member</th>
          <th>Handle</th>
          <th>Team Role</th>
          <th>Primary Role</th>
          <th>Institution</th>
          <th>Portfolio Handles</th>
        </tr>
      </thead>
      <tbody>
        ${memberRows}
      </tbody>
    </table>

    <div class="footer">
      Generated by HackMatch platform on ${escapeManifestHtml(exportedAt)} ·
      ${escapeManifestHtml(integrity.recordedByLabel)}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Builds a deterministic PDF-1.4 binary document for check-in verification (US-024 / FR-071).
 * Requires zero external dependencies or native binary installations.
 */
export function buildDeterministicManifestPdf(
  payload: TeamManifestExportPayload
): Uint8Array {
  const scrubbed = scrubManifestPrivateFields(payload);
  const { snapshot, integrity, exportedAt } = scrubbed;

  const lines: string[] = [];
  lines.push('BT');
  lines.push('/F2 16 Tf');
  lines.push('50 740 Td');
  lines.push(`(HackMatch Team Verification Card) Tj`);
  lines.push('ET');

  lines.push('BT');
  lines.push('/F2 13 Tf');
  lines.push('50 715 Td');
  lines.push(`(Team: ${escapePdfString(snapshot.teamName)}) Tj`);
  lines.push('ET');

  lines.push('BT');
  lines.push('/F1 10 Tf');
  lines.push('50 695 Td');
  lines.push(`(Event: ${escapePdfString(snapshot.eventTitle)}) Tj`);
  lines.push('ET');

  lines.push('BT');
  lines.push('/F1 9 Tf');
  lines.push('50 675 Td');
  lines.push(
    `(Lock time recorded by HackMatch: ${escapePdfString(snapshot.lockedAt)} | Members: ${snapshot.memberCount}) Tj`
  );
  lines.push('ET');

  lines.push('BT');
  lines.push('/F2 9 Tf');
  lines.push('50 655 Td');
  lines.push(`(SHA-256 Integrity Checksum: ${escapePdfString(integrity.checksum)}) Tj`);
  lines.push('ET');

  lines.push('BT');
  lines.push('/F1 8 Tf');
  lines.push('50 635 Td');
  lines.push(
    `(Integrity Notice: ${escapePdfString(
      'Checksum compares against server record only; organizer acceptance is not assumed.'
    )}) Tj`
  );
  lines.push('ET');

  lines.push('BT');
  lines.push('/F1 8 Tf');
  lines.push('50 620 Td');
  lines.push(
    `(Privacy Notice: ${escapePdfString(
      'Account emails and private contact handles are strictly excluded.'
    )}) Tj`
  );
  lines.push('ET');

  lines.push('BT');
  lines.push('/F2 11 Tf');
  lines.push('50 595 Td');
  lines.push(`(Confirmed Locked Roster:) Tj`);
  lines.push('ET');

  let y = 575;
  for (const m of snapshot.members) {
    const roleText = `${m.teamRole}${m.primaryRole ? ` - ${m.primaryRole}` : ''}`;
    const handleText = m.handle ? `@${m.handle}` : '';
    const instText = m.institution ? ` (${m.institution})` : '';
    const memberHeader = `${m.displayName} [${roleText}] ${handleText}${instText}`;

    lines.push('BT');
    lines.push('/F2 9 Tf');
    lines.push(`50 ${y} Td`);
    lines.push(`(${escapePdfString(memberHeader)}) Tj`);
    lines.push('ET');
    y -= 15;

    if (m.portfolioLinks.length > 0) {
      const linkSummary = m.portfolioLinks
        .map((p) => (p.label ? `${p.label}: ${p.url}` : p.url))
        .join(' | ');
      lines.push('BT');
      lines.push('/F1 8 Tf');
      lines.push(`65 ${y} Td`);
      lines.push(`(Portfolio: ${escapePdfString(linkSummary)}) Tj`);
      lines.push('ET');
      y -= 15;
    }

    if (y < 80) break; // Keep on single page
  }

  lines.push('BT');
  lines.push('/F1 7 Tf');
  lines.push('50 45 Td');
  lines.push(
    `(${escapePdfString(
      `Exported: ${exportedAt} | Schema v${snapshot.schemaVersion} | HackMatch Platform`
    )}) Tj`
  );
  lines.push('ET');

  const streamContent = lines.join('\n');
  const streamLength = Buffer.byteLength(streamContent, 'utf-8');

  const pdfObjects = [
    // 1: Catalog
    '1 0 obj\n<<\n  /Type /Catalog\n  /Pages 2 0 R\n>>\nendobj',
    // 2: Pages
    '2 0 obj\n<<\n  /Type /Pages\n  /Kids [3 0 R]\n  /Count 1\n>>\nendobj',
    // 3: Page
    '3 0 obj\n<<\n  /Type /Page\n  /Parent 2 0 R\n  /MediaBox [0 0 612 792]\n  /Contents 4 0 R\n  /Resources <<\n    /Font <<\n      /F1 5 0 R\n      /F2 6 0 R\n    >>\n  >>\n>>\nendobj',
    // 4: Contents
    `4 0 obj\n<<\n  /Length ${streamLength}\n>>\nstream\n${streamContent}\nendstream\nendobj`,
    // 5: Font F1 (Helvetica)
    '5 0 obj\n<<\n  /Type /Font\n  /Subtype /Type1\n  /BaseFont /Helvetica\n>>\nendobj',
    // 6: Font F2 (Helvetica-Bold)
    '6 0 obj\n<<\n  /Type /Font\n  /Subtype /Type1\n  /BaseFont /Helvetica-Bold\n>>\nendobj',
  ];

  let offset = 9; // strlen('%PDF-1.4\n')
  const offsets: number[] = [0]; // obj 0 is generation 65535 f
  let body = '%PDF-1.4\n';

  for (const obj of pdfObjects) {
    offsets.push(offset);
    body += `${obj}\n`;
    offset += Buffer.byteLength(obj, 'utf-8') + 1;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += `${offsets[i].toString().padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<<\n  /Size ${offsets.length}\n  /Root 1 0 R\n>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const fullPdf = body + xref + trailer;

  return Buffer.from(fullPdf, 'utf-8');
}

/**
 * Builds downloadable artifact details based on selected format (US-024 / FR-071).
 */
export function buildManifestExportArtifact(
  payload: TeamManifestExportPayload,
  format: ManifestExportFormat
): ManifestExportArtifact {
  const teamId = payload.teamId;

  switch (format) {
    case 'html':
      return {
        format: 'html',
        filename: `team-verification-card-${teamId}.html`,
        contentType: 'text/html; charset=utf-8',
        content: renderPrintableManifestHtml(payload),
      };
    case 'pdf':
      return {
        format: 'pdf',
        filename: `team-verification-card-${teamId}.pdf`,
        contentType: 'application/pdf',
        content: buildDeterministicManifestPdf(payload),
      };
    case 'json':
    default:
      return {
        format: 'json',
        filename: `team-manifest-${teamId}.json`,
        contentType: 'application/json; charset=utf-8',
        content: formatManifestAsJson(payload),
      };
  }
}
