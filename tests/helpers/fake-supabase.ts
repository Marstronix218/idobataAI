import { vi } from "vitest";

// A small in-memory stand-in for the PostgREST query builder, enough for the
// Pivot A reaction engine, splitter and routes: select with eq/neq/gte/lte/lt/in/
// is/like filters, order, limit, maybeSingle/single, insert and update, plus
// rpc. Column lists in select() are ignored; whole rows come back.

export type Row = Record<string, unknown>;
export type DbError = { message: string; code?: string };
type Filter = (row: Row) => boolean;

export interface FakeSupabaseOptions {
  /** Every query on these tables answers with this error. */
  errors?: Record<string, DbError>;
  /** Only inserts into these tables answer with this error. */
  insertErrors?: Record<string, DbError>;
  /** rpc(name, args) handler; unknown functions answer `{ data: null, error: null }`. */
  rpc?: (name: string, args: Record<string, unknown>, db: FakeSupabase) => { data: unknown; error: DbError | null } | undefined;
  /** Runs after an update on `table` changed `rows`, like a trigger would. */
  afterUpdate?: (table: string, rows: Row[], db: FakeSupabase) => void;
}

export interface FakeSupabase {
  tables: Record<string, Row[]>;
  inserted: Record<string, Row[]>;
  updated: Record<string, Array<{ patch: Row; rows: Row[] }>>;
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

function compare(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as string | number) < (b as string | number) ? -1 : 1;
}

export function createFakeSupabase(initial: Record<string, Row[]> = {}, options: FakeSupabaseOptions = {}): FakeSupabase {
  const db: FakeSupabase = {
    tables: Object.fromEntries(Object.entries(initial).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])),
    inserted: {},
    updated: {},
    from: vi.fn(),
    rpc: vi.fn(),
  };

  db.from.mockImplementation((table: string) => {
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    let order: { column: string; ascending: boolean } | null = null;
    let limit: number | null = null;

    const rowsOf = () => (db.tables[table] ??= []);
    const matching = () => rowsOf().filter((row) => filters.every((filter) => filter(row)));

    function run(): { data: unknown; error: DbError | null } {
      const error = options.errors?.[table];
      if (error) return { data: null, error };
      if (mode === "insert") {
        const insertError = options.insertErrors?.[table];
        if (insertError) return { data: null, error: insertError };
        const rows = (Array.isArray(payload) ? payload : [payload ?? {}]).map((row) => ({ id: `${table}-${rowsOf().length + 1}`, created_at: new Date().toISOString(), ...row }));
        rowsOf().push(...rows);
        (db.inserted[table] ??= []).push(...rows);
        return { data: rows, error: null };
      }
      if (mode === "update") {
        const rows = matching();
        for (const row of rows) Object.assign(row, payload);
        (db.updated[table] ??= []).push({ patch: { ...(payload as Row) }, rows: rows.map((row) => ({ ...row })) });
        if (rows.length > 0) options.afterUpdate?.(table, rows, db);
        return { data: rows.map((row) => ({ ...row })), error: null };
      }
      let rows = matching();
      if (order) {
        const { column, ascending } = order;
        rows = [...rows].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return { data: rows.map((row) => ({ ...row })), error: null };
    }

    const builder = {
      select: vi.fn(() => builder),
      insert: vi.fn((rows: Row | Row[]) => { mode = "insert"; payload = rows; return builder; }),
      update: vi.fn((patch: Row) => { mode = "update"; payload = patch; return builder; }),
      eq: vi.fn((column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; }),
      neq: vi.fn((column: string, value: unknown) => { filters.push((row) => row[column] !== value); return builder; }),
      not: vi.fn((column: string, operator: string, value: unknown) => {
        if (operator !== "is") throw new Error(`fake not(): unsupported operator ${operator}`);
        filters.push((row) => (row[column] ?? null) !== value);
        return builder;
      }),
      gte: vi.fn((column: string, value: unknown) => { filters.push((row) => compare(row[column], value) >= 0); return builder; }),
      lte: vi.fn((column: string, value: unknown) => { filters.push((row) => compare(row[column], value) <= 0); return builder; }),
      lt: vi.fn((column: string, value: unknown) => { filters.push((row) => compare(row[column], value) < 0); return builder; }),
      in: vi.fn((column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; }),
      is: vi.fn((column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; }),
      like: vi.fn((column: string, pattern: string) => {
        const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("%", ".*")}$`);
        filters.push((row) => regex.test(String(row[column])));
        return builder;
      }),
      order: vi.fn((column: string, opts?: { ascending?: boolean }) => { order = { column, ascending: opts?.ascending ?? true }; return builder; }),
      limit: vi.fn((count: number) => { limit = count; return builder; }),
      abortSignal: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const result = run();
        if (result.error) return result;
        const data = result.data as Row[];
        if (data.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116" } };
        return { data: data[0] ?? null, error: null };
      }),
      single: vi.fn(async () => {
        const result = run();
        if (result.error) return result;
        const data = result.data as Row[];
        if (data.length !== 1) return { data: null, error: { message: "not exactly one row", code: "PGRST116" } };
        return { data: data[0], error: null };
      }),
      then: (resolve: (value: { data: unknown; error: DbError | null }) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  });

  db.rpc.mockImplementation(async (name: string, args: Record<string, unknown> = {}) =>
    options.rpc?.(name, args, db) ?? { data: null, error: null });

  return db;
}
