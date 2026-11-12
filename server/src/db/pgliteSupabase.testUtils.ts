import type { PGlite } from '@electric-sql/pglite';

/**
 * US-029 / #272 test fixture: a PGlite-backed stand-in for the subset of the
 * supabase-js client the auth repositories use. It lets route tests run the
 * REAL repository query code against REAL PostgreSQL functions, constraints,
 * and RLS-free service-role semantics, without a live Supabase project.
 *
 * It emulates PostgREST behavior (single/maybeSingle row rules, head counts,
 * `{ data, error }` results, ISO timestamps); it is not the Supabase network
 * layer. Only identifiers matching IDENT are accepted.
 */

type Row = Record<string, unknown>;
type Filter = { column: string; op: 'eq' | 'is' | 'in' | 'gt' | 'gte'; value: unknown };
interface Result {
  data: unknown;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
  count?: number | null;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`pgliteSupabase: unsupported identifier "${name}"`);
  return name;
}

function columnList(columns: string): string {
  if (columns.trim() === '*') return '*';
  return columns
    .split(',')
    .map((column) => ident(column.trim()))
    .join(', ');
}

/** PostgREST returns timestamps as ISO strings, never Date objects. */
function normalize(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function toError(error: unknown): Result['error'] {
  const record = (error ?? {}) as Record<string, unknown>;
  return {
    message: String(record.message ?? error),
    code: typeof record.code === 'string' ? record.code : undefined,
    details: typeof record.detail === 'string' ? record.detail : undefined,
    hint: typeof record.hint === 'string' ? record.hint : undefined,
  };
}

class QueryBuilder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private columns = '*';
  private returning: string | null = null;
  private payload: Row = {};
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';
  private headCount = false;

  constructor(
    private readonly db: PGlite,
    private readonly table: string
  ) {
    ident(table);
  }

  select(columns = '*', options: { count?: 'exact'; head?: boolean } = {}) {
    if (this.op === 'select') {
      this.columns = columns;
      this.headCount = options.count === 'exact' && options.head === true;
    } else {
      this.returning = columns;
    }
    return this;
  }
  insert(row: Row) {
    this.op = 'insert';
    this.payload = row;
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    this.payload = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }
  is(column: string, value: null) {
    this.filters.push({ column, op: 'is', value });
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push({ column, op: 'in', value: values });
    return this;
  }
  gt(column: string, value: unknown) {
    this.filters.push({ column, op: 'gt', value });
    return this;
  }
  gte(column: string, value: unknown) {
    this.filters.push({ column, op: 'gte', value });
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }
  limit(count: number) {
    this.limitCount = count;
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybeSingle';
    return this;
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private where(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const clauses = this.filters.map(({ column, op, value }) => {
      const col = ident(column);
      if (op === 'is') {
        if (value !== null) throw new Error('pgliteSupabase: only .is(column, null) is supported');
        return `${col} IS NULL`;
      }
      params.push(value);
      const ref = `$${params.length}`;
      if (op === 'in') return `${col} = ANY(${ref})`;
      return `${col} ${op === 'eq' ? '=' : op === 'gt' ? '>' : '>='} ${ref}`;
    });
    return ` WHERE ${clauses.join(' AND ')}`;
  }

  private sql(): { text: string; params: unknown[] } {
    const params: unknown[] = [];
    const table = this.table;
    if (this.op === 'insert') {
      const keys = Object.keys(this.payload).map(ident);
      const values = keys.map((key) => {
        params.push(this.payload[key]);
        return `$${params.length}`;
      });
      const returning = this.returning ? ` RETURNING ${columnList(this.returning)}` : '';
      return { text: `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${values.join(', ')})${returning}`, params };
    }
    if (this.op === 'update') {
      const sets = Object.keys(this.payload).map((key) => {
        params.push(this.payload[key]);
        return `${ident(key)} = $${params.length}`;
      });
      const where = this.where(params);
      const returning = this.returning ? ` RETURNING ${columnList(this.returning)}` : '';
      return { text: `UPDATE ${table} SET ${sets.join(', ')}${where}${returning}`, params };
    }
    if (this.op === 'delete') {
      const where = this.where(params);
      const returning = this.returning ? ` RETURNING ${columnList(this.returning)}` : '';
      return { text: `DELETE FROM ${table}${where}${returning}`, params };
    }
    const where = this.where(params);
    if (this.headCount) return { text: `SELECT COUNT(*)::int AS count FROM ${table}${where}`, params };
    const order = this.orders.length
      ? ` ORDER BY ${this.orders.map((o) => `${ident(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ')}`
      : '';
    const limit = this.limitCount != null ? ` LIMIT ${Math.max(0, Math.floor(this.limitCount))}` : '';
    return { text: `SELECT ${columnList(this.columns)} FROM ${table}${where}${order}${limit}`, params };
  }

  private async execute(): Promise<Result> {
    let rows: Row[];
    try {
      const { text, params } = this.sql();
      rows = ((await this.db.query<Row>(text, params)).rows ?? []).map(normalize);
    } catch (error: unknown) {
      return { data: null, error: toError(error) };
    }
    if (this.headCount) return { data: null, error: null, count: Number(rows[0]?.count ?? 0) };
    const hasRows = this.op === 'select' || this.returning !== null;
    if (!hasRows) return { data: null, error: null };
    if (this.mode === 'many') return { data: rows, error: null };
    if (rows.length === 1) return { data: rows[0], error: null };
    if (rows.length === 0 && this.mode === 'maybeSingle') return { data: null, error: null };
    return {
      data: null,
      error: {
        code: 'PGRST116',
        message: `JSON object requested, multiple (or no) rows returned (${rows.length})`,
      },
    };
  }
}

export interface PgliteSupabaseClient {
  rpc(fn: string, params: Record<string, unknown>): Promise<Result>;
  from(table: string): QueryBuilder;
}

export function createPgliteSupabaseClient(db: PGlite): PgliteSupabaseClient {
  return {
    async rpc(fn, params) {
      const names = Object.keys(params).map(ident);
      const args = names.map((name, index) => `${name} => $${index + 1}`).join(', ');
      try {
        const result = await db.query<Row>(
          `SELECT * FROM ${ident(fn)}(${args})`,
          names.map((name) => params[name])
        );
        return { data: (result.rows ?? []).map(normalize), error: null };
      } catch (error: unknown) {
        return { data: null, error: toError(error) };
      }
    },
    from(table) {
      return new QueryBuilder(db, table);
    },
  };
}
