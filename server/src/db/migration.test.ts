import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('0001_create_participants_table.sql Migration DDL', () => {
  const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/0001_create_participants_table.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('migration file exists and is not empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('enforces Row Level Security explicitly on participants table', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+participants\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i);
  });

  it('enforces strict role constraints for PART and ADMIN', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*role\s+IN\s*\(\s*'PART'\s*,\s*'ADMIN'\s*\)\s*\)/i);
  });

  it('defaults is_verified to FALSE', () => {
    expect(sql).toMatch(/is_verified\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i);
  });

  it('enforces unique constraints on firebase_uid and case-insensitive email', () => {
    expect(sql).toMatch(/firebase_uid.*UNIQUE/i);
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX.*ON\s+participants\s*\(\s*LOWER\s*\(\s*email\s*\)\s*\)/i);
  });

  it('attaches automatic updated_at trigger and function', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+set_updated_at\s*\(\)/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trigger_participants_updated_at/i);
  });
});
