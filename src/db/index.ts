import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Executa e devolve quantas linhas foram afetadas. */
  run(sql: string, params?: unknown[]): Promise<number>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// ---- Postgres de verdade (produção / Docker) ------------------------------------

// Por padrão o driver devolve NUMERIC e BIGINT como texto e DATE como Date com fuso.
// Aqui: números viram number e datas ficam 'AAAA-MM-DD'.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

function pgQueryable(client: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query(sql, params) {
      return (await client.query(sql, params)).rows;
    },
    async one(sql, params) {
      return (await client.query(sql, params)).rows[0];
    },
    async run(sql, params) {
      return (await client.query(sql, params)).rowCount ?? 0;
    },
  };
}

function createPgDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    ...pgQueryable(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(pgQueryable(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

// ---- Postgres embutido em memória (testes) ----------------------------------------

async function createPgliteDb(): Promise<Db> {
  // Dependência só de desenvolvimento: carregada sob demanda.
  const { PGlite, types } = await import('@electric-sql/pglite');
  const lite = new PGlite({
    parsers: { [types.NUMERIC]: Number, [types.INT8]: Number, [types.DATE]: (v: string) => v },
  });
  type Lite = Pick<typeof lite, 'query'>;
  const wrap = (c: Lite): Queryable => ({
    async query(sql, params) {
      return (await c.query(sql, params)).rows as never[];
    },
    async one(sql, params) {
      return (await c.query(sql, params)).rows[0] as never;
    },
    async run(sql, params) {
      return (await c.query(sql, params)).affectedRows ?? 0;
    },
  });
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t))),
    async exec(sql) {
      await lite.exec(sql);
    },
    close: () => lite.close(),
  };
}

// ---- Instância compartilhada --------------------------------------------------------

export let db: Db;

export async function connectDb(url: string): Promise<Db> {
  db = url.startsWith('pglite://') ? await createPgliteDb() : createPgDb(url);
  await migrate(db);
  return db;
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Aplica, em ordem, os arquivos .sql de migrations/ que ainda não rodaram. */
async function migrate(database: Db) {
  await database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await database.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await database.tx(async (q) => {
      for (const statement of splitStatements(sql)) await q.run(statement);
      await q.run('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`Migration aplicada: ${file}`);
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
