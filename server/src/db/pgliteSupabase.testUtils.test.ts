import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteSupabaseClient } from './pgliteSupabase.testUtils.js';

/** #272: the PGlite adapter must mirror the PostgREST semantics the repositories rely on. */
describe('PGlite Supabase test adapter', () => {
  let db: PGlite;
  let client: ReturnType<typeof createPgliteSupabaseClient>;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE items (id INT PRIMARY KEY, label TEXT, status TEXT, done_at TIMESTAMPTZ);
      INSERT INTO items VALUES (1, 'a', 'Active', NULL), (2, 'b', 'Pending', NOW()), (3, 'c', 'Pending', NULL);
      CREATE FUNCTION add_item(p_id INT, p_label TEXT, p_tags TEXT[]) RETURNS TABLE (item_id INT, tag_count INT)
        LANGUAGE sql AS $$ INSERT INTO items (id, label, status) VALUES (p_id, p_label, 'Pending')
        RETURNING id, cardinality(p_tags) $$;
      CREATE FUNCTION fail_item() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CUSTOM_FAILURE'; END $$;
    `);
    client = createPgliteSupabaseClient(db);
  });

  afterAll(async () => db.close());

  it('maybeSingle returns null for zero rows, the row for one, and PGRST116 for many; single requires one', async () => {
    expect(await client.from('items').select('id').eq('id', 99).maybeSingle()).toEqual({ data: null, error: null });
    expect((await client.from('items').select('id, label').eq('id', 1).maybeSingle()).data).toEqual({ id: 1, label: 'a' });
    expect((await client.from('items').select('*').eq('status', 'Pending').maybeSingle()).error?.code).toBe('PGRST116');
    expect((await client.from('items').select('*').eq('id', 99).single()).error?.code).toBe('PGRST116');
  });

  it('supports is(null), in, order, limit, head counts, and ISO timestamps', async () => {
    const pendingNull = await client.from('items').select('id').eq('status', 'Pending').is('done_at', null);
    expect(pendingNull.data).toEqual([{ id: 3 }]);
    const ordered = await client.from('items').select('status').in('status', ['Active', 'Pending']).order('status', { ascending: true }).limit(1);
    expect(ordered.data).toEqual([{ status: 'Active' }]); // repositories rely on Active sorting first
    expect((await client.from('items').select('*', { count: 'exact', head: true }).eq('status', 'Pending')).count).toBe(2);
    const stamped = await client.from('items').select('done_at').eq('id', 2).single();
    expect(typeof (stamped.data as { done_at: unknown }).done_at).toBe('string');
  });

  it('runs insert/update/delete with optional RETURNING and named-argument RPCs with arrays', async () => {
    expect((await client.from('items').insert({ id: 10, label: 'x', status: 'Pending' }).select('id').single()).data).toEqual({ id: 10 });
    expect((await client.from('items').update({ label: 'y' }).eq('id', 10).select('label').maybeSingle()).data).toEqual({ label: 'y' });
    expect(await client.from('items').delete().eq('id', 10)).toEqual({ data: null, error: null });
    expect((await client.rpc('add_item', { p_id: 11, p_label: 'z', p_tags: ['a', 'b'] })).data).toEqual([{ item_id: 11, tag_count: 2 }]);
  });

  it('returns database errors as { error } with the raised message, and rejects unsafe identifiers', async () => {
    const failed = await client.rpc('fail_item', {});
    expect(failed.data).toBeNull();
    expect(failed.error?.message).toContain('CUSTOM_FAILURE');
    expect(() => client.from('items; DROP TABLE items')).toThrow(/unsupported identifier/);
    const unsafeColumn = await client.from('items').select('id; DROP').eq('id', 1);
    expect(unsafeColumn.error?.message).toMatch(/unsupported identifier/);
    expect((await db.query('SELECT COUNT(*)::int AS n FROM items')).rows).toEqual([{ n: 4 }]);
  });
});
