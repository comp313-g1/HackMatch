/**
 * US-028 / #262 — static guard for the React app: nothing in the client may send a request
 * that could change an administrative action record. Reads the source, so a future change
 * that adds a write call to the audit endpoint (or a "delete record" control) fails here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const isTest = (f: string) => /\.test\.[tj]sx?$/.test(f);
const sources = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/');
const read = (f: string) => fs.readFileSync(f, 'utf8');

describe('the React app can only read audit records (US-028 / #262)', () => {
  const auditFiles = sources.filter((f) => rel(f).startsWith('components/audit/'));

  it('finds the audit module it is meant to guard (so it cannot pass vacuously)', () => {
    const names = auditFiles.map(rel);
    expect(names).toContain('components/audit/auditApi.ts');
    expect(names).toContain('components/audit/AuditRecordsPage.tsx');
  });

  it('only auditApi.ts talks to the audit endpoint, and only with GET', () => {
    // The API path itself (the page URL alias ?view=audit-records in App.tsx is not an API call).
    const users = sources.filter((f) => read(f).includes('/api/admin/audit')).map(rel);
    expect(users).toEqual(['components/audit/auditApi.ts']);

    const api = read(path.join(SRC, 'components/audit/auditApi.ts'));
    const methods = [...api.matchAll(/method:\s*['"`](\w+)['"`]/g)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((m) => m === 'GET')).toBe(true);
    expect(api).not.toMatch(/\b(PUT|PATCH|DELETE|POST)\b/);
  });

  it('exports no function that could change a record', () => {
    const api = read(path.join(SRC, 'components/audit/auditApi.ts'));
    const exported = [...api.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
    expect(exported).toEqual(['fetchAuditRecords']);
    expect(exported.some((n) => /^(create|update|delete|remove|edit|redact|save|put|patch|post)/i.test(n))).toBe(false);
  });

  it('the audit components contain no edit or delete controls, handlers or forms for records', () => {
    for (const file of auditFiles.filter((f) => f.endsWith('.tsx'))) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(/onDelete|onEdit|onRemove|onUpdate|deleteRecord|editRecord|updateRecord/);
      expect(text, rel(file)).not.toMatch(/method=["'](post|put|patch|delete)["']/i);
      expect(text, rel(file)).not.toMatch(/contentEditable|contenteditable/);
      expect(text, rel(file)).not.toMatch(/>\s*(Delete|Edit|Remove|Undo)\s*</);
    }
  });

  it('no other part of the client calls a write method against any admin audit path', () => {
    for (const file of sources) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(/admin\/audit[^'"`]*['"`][^;]{0,120}method:\s*['"`](POST|PUT|PATCH|DELETE)/i);
    }
  });
});
