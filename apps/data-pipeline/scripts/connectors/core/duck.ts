/**
 * Lazy DuckDB helper for querying remote GeoParquet over httpfs (anonymous).
 * Only loaded by connectors that need it (Foursquare OS Places, Overture), so
 * other connectors don't pay the native-module cost.
 */
export async function duckQuery(
  sql: string,
  opts: { setup?: string[]; timeoutMs?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  for (const s of opts.setup ?? ['INSTALL httpfs;', 'LOAD httpfs;', "SET s3_region='us-east-1';"]) {
    await conn.run(s);
  }
  const work = (async () => {
    const reader = await conn.runAndReadAll(sql);
    const rows = reader.getRowObjects();
    return rows.map(sanitize);
  })();
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error(`duckdb timeout after ${opts.timeoutMs ?? 25_000}ms`)), opts.timeoutMs ?? 25_000),
  );
  return Promise.race([work, timeout]);
}

/** DuckDB returns BigInt/typed values; make them JSON-safe. */
function sanitize(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
