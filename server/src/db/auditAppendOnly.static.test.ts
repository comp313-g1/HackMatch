/**
 * US-028 / #262 — static guard: nothing in the repository may modify administrative action
 * records. This reads the source tree and the migrations, so a future change that adds an
 * UPDATE/DELETE/TRUNCATE (in code or SQL), widens the grants, or drops the append-only
 * triggers fails here before it can ship.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const TABLE = 'event_action_records';

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(REPO, f).replace(/\\/g, '/');
const isTest = (f: string) => /\.test\.[tj]sx?$/.test(f);
const isSource = (f: string) => /\.(ts|tsx|js|mjs)$/.test(f) && !isTest(f);
const read = (f: string) => fs.readFileSync(f, 'utf8');
/** SQL with `--` line comments removed, so explanatory comments cannot trip or hide a match. */
const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, '');

const sourceFiles = ['server/src', 'db-seed/src', 'client/src']
  .flatMap((d) => walk(path.join(REPO, d)))
  .filter(isSource);

const migrationFiles = walk(path.join(REPO, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();

const MUTATING_SQL = new RegExp(
  String.raw`\b(UPDATE\s+(ONLY\s+)?(public\.)?${TABLE}\b|DELETE\s+FROM\s+(ONLY\s+)?(public\.)?${TABLE}\b|TRUNCATE\s+(TABLE\s+)?(ONLY\s+)?(public\.)?${TABLE}\b|INSERT\s+INTO\s+(public\.)?${TABLE}\b[\s\S]{0,2000}?ON\s+CONFLICT[\s\S]{0,200}?DO\s+UPDATE)`,
  'i'
);

describe('administrative action records are append-only in code (US-028 / #262)', () => {
  it('the guard actually sees the code that writes audit records (so it cannot pass vacuously)', () => {
    const users = sourceFiles.filter((f) => read(f).includes(TABLE)).map(rel);
    expect(users).toContain('server/src/db/moderation.repository.ts');
  });

  it('only the two known repositories mention the table', () => {
    const users = sourceFiles.filter((f) => read(f).includes(TABLE)).map(rel).sort();
    expect(users).toEqual(['server/src/db/auditRecords.repository.ts', 'server/src/db/moderation.repository.ts']);
  });

  it('every query chain on the table in application code is an insert or a select, never update/delete/upsert', () => {
    const chains: Array<{ file: string; chain: string }> = [];
    for (const file of sourceFiles) {
      const text = read(file);
      for (const m of text.matchAll(new RegExp(String.raw`from\(\s*['"\`]${TABLE}['"\`]\s*\)([\s\S]*?);`, 'g'))) {
        chains.push({ file: rel(file), chain: m[1] });
      }
    }
    expect(chains.length).toBeGreaterThanOrEqual(2); // the insert and the case history read
    for (const { file, chain } of chains) {
      expect(chain, `${file}: ${chain.slice(0, 80)}`).not.toMatch(/\.(update|delete|upsert)\s*\(/);
      expect(chain, file).toMatch(/\.(insert|select)\s*\(/);
    }
    expect(chains.some((c) => /\.insert\s*\(/.test(c.chain))).toBe(true);
  });

  it('no application code runs raw SQL that modifies the table', () => {
    for (const file of sourceFiles) {
      expect(read(file), rel(file)).not.toMatch(MUTATING_SQL);
    }
  });

  it('the only database function that reads audit records performs no writes', () => {
    const sql = stripSqlComments(read(path.join(REPO, 'supabase/migrations/0049_create_admin_audit_record_query.sql')));
    const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION query_admin_audit_records'));
    expect(body.slice(0, body.indexOf('REVOKE ALL ON FUNCTION'))).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i
    );
  });
});

describe('administrative action records are append-only in migrations (US-028 / #262)', () => {
  it('finds the migrations it is meant to guard', () => {
    const names = migrationFiles.map((f) => path.basename(f));
    expect(names).toContain('0006_create_event_action_records.sql');
    expect(names).toContain('0050_enforce_audit_records_least_privilege.sql');
  });

  it('no migration updates, deletes from, truncates, or upserts into the table', () => {
    for (const file of migrationFiles) {
      expect(stripSqlComments(read(file)), rel(file)).not.toMatch(MUTATING_SQL);
    }
  });

  it('no migration disables, drops, or replaces the append-only triggers', () => {
    for (const file of migrationFiles) {
      const sql = stripSqlComments(read(file));
      expect(sql, rel(file)).not.toMatch(new RegExp(String.raw`ALTER\s+TABLE\s+(public\.)?${TABLE}\s+(DISABLE|ENABLE\s+REPLICA)\s+TRIGGER`, 'i'));
      expect(sql, rel(file)).not.toMatch(
        /DROP\s+TRIGGER\s+(IF\s+EXISTS\s+)?trigger_event_action_records_prevent_(modification|truncate)\s+ON\s+(public\.)?event_action_records(?![\s\S]{0,40}CREATE\s+TRIGGER)/i
      );
    }
  });

  it('the three guard triggers are defined once, in 0006', () => {
    const sql = stripSqlComments(read(path.join(REPO, 'supabase/migrations/0006_create_event_action_records.sql')));
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_event_action_records_prevent_modification\s+BEFORE\s+UPDATE\s+OR\s+DELETE/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_event_action_records_prevent_truncate\s+BEFORE\s+TRUNCATE/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_check_event_action_actor_role\s+BEFORE\s+INSERT/i);
  });

  it('the final grants on the table are only SELECT and INSERT for service_role', () => {
    const statements: Array<{ file: string; sql: string }> = [];
    for (const file of migrationFiles) {
      for (const m of stripSqlComments(read(file)).matchAll(/\b(GRANT|REVOKE)\b[^;]*?\bON\s+(TABLE\s+)?(public\.)?event_action_records\b[^;]*;/gi)) {
        statements.push({ file: path.basename(file), sql: m[0].replace(/\s+/g, ' ') });
      }
    }
    const grants = statements.filter((s) => /^GRANT/i.test(s.sql));
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      expect(g.sql, g.file).toMatch(/^GRANT\s+SELECT,\s*INSERT\s+ON\s+(TABLE\s+)?event_action_records\s+TO\s+service_role;$/i);
    }
    // ...and the broad revoke that makes that grant the whole story exists.
    expect(statements.some((s) => /REVOKE\s+ALL\s+ON\s+(TABLE\s+)?event_action_records\s+FROM\s+PUBLIC,\s*anon,\s*authenticated,\s*service_role/i.test(s.sql))).toBe(true);
  });

  it('no migration grants any role broader access to the table', () => {
    for (const file of migrationFiles) {
      const sql = stripSqlComments(read(file));
      expect(sql, rel(file)).not.toMatch(
        /GRANT\s+(ALL|UPDATE|DELETE|TRUNCATE|TRIGGER|REFERENCES)[^;]*\bON\s+(TABLE\s+)?(public\.)?event_action_records\b/i
      );
      expect(sql, rel(file)).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+TABLES/i);
    }
  });

  it('no migration adds a row-level-security policy that could allow modification', () => {
    for (const file of migrationFiles) {
      expect(stripSqlComments(read(file)), rel(file)).not.toMatch(
        new RegExp(String.raw`CREATE\s+POLICY[^;]*\bON\s+(public\.)?${TABLE}\b`, 'i')
      );
    }
  });
});
