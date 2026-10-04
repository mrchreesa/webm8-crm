import { attachDatabasePool } from '@vercel/functions';
import { Pool, types } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readdirSync, readFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from './config.js';
import { EVENT_NAMES, type Settings } from '../src/domain.js';
export interface QueryResult {
  rows: any[];
  rowCount: number;
}
export interface DatabaseDriver {
  dialect: 'sqlite' | 'postgres';
  serial?: boolean;
  query(sql: string, values: unknown[]): Promise<QueryResult>;
  connect?(): Promise<{ query: DatabaseDriver['query']; release(): void }>;
  close(): Promise<void>;
}
// Only SQL integer columns use this parser. Meta IDs are always TEXT.
export function safeInteger(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Database integer exceeds the safe range.');
  return n;
}
function parameters(sql: string, args: unknown[], postgres: boolean) {
  const named =
    args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])
      ? (args[0] as Record<string, unknown>)
      : undefined;
  let index = 0;
  const values: unknown[] = [];
  const text = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?|@[A-Za-z_][A-Za-z0-9_]*/g, (token) => {
    if (token.startsWith("'") || token.startsWith('"')) return token;
    const value = token === '?' ? args[index++] : named?.[token.slice(1)];
    if (value === undefined) throw new Error('Missing database parameter.');
    values.push(value);
    return postgres ? `$${values.length}` : '?';
  });
  return { text, values };
}
type Connection = { query: DatabaseDriver['query'] };
export class DB {
  private context = new AsyncLocalStorage<Connection>();
  private tail: Promise<unknown> = Promise.resolve();
  private savepoint = 0;
  open = true;
  constructor(private driver: DatabaseDriver) {}
  get dialect() {
    return this.driver.dialect;
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => {});
    return result;
  }
  private raw(sql: string, values: unknown[] = []) {
    const current = this.context.getStore();
    if (current) return current.query(sql, values);
    const task = () => this.driver.query(sql, values);
    return this.driver.serial ? this.serial(task) : task();
  }
  prepare(sql: string) {
    const query = (...args: unknown[]) => {
      const p = parameters(sql, args, this.dialect === 'postgres');
      return this.raw(p.text, p.values);
    };
    return {
      get: async (...args: unknown[]): Promise<any> => (await query(...args)).rows[0],
      all: async (...args: unknown[]): Promise<any[]> => (await query(...args)).rows,
      run: async (...args: unknown[]) => ({ changes: (await query(...args)).rowCount }),
    };
  }
  async exec(sql: string) {
    await this.raw(sql);
  }
  async pragma(sql: string) {
    if (this.dialect === 'sqlite') await this.exec(`PRAGMA ${sql}`);
  }
  transaction<T>(fn: () => T | Promise<T>) {
    const run = async () => {
      const current = this.context.getStore();
      if (current) {
        const name = `crm_savepoint_${++this.savepoint}`;
        await current.query(`SAVEPOINT ${name}`, []);
        try {
          const value = await fn();
          await current.query(`RELEASE SAVEPOINT ${name}`, []);
          return value;
        } catch (error) {
          await current.query(`ROLLBACK TO SAVEPOINT ${name}`, []);
          await current.query(`RELEASE SAVEPOINT ${name}`, []);
          throw error;
        }
      }
      const client = this.driver.connect ? await this.driver.connect() : this.driver;
      try {
        await client.query(this.dialect === 'postgres' ? 'BEGIN' : 'BEGIN IMMEDIATE', []);
        // Short write lock shared by web and worker. Meta network calls happen after commit.
        if (this.dialect === 'postgres')
          await client.query('SELECT pg_advisory_xact_lock(782163401)', []);
        const value = await this.context.run(client, fn);
        await client.query('COMMIT', []);
        return value;
      } catch (error) {
        await client.query('ROLLBACK', []).catch(() => {});
        throw error;
      } finally {
        if ('release' in client) client.release();
      }
    };
    return {
      immediate: () => (this.context.getStore() || !this.driver.serial ? run() : this.serial(run)),
    };
  }
  async close() {
    if (!this.open) return;
    await this.tail;
    await this.driver.close();
    this.open = false;
  }
}
export async function migrateDatabase(db: DB) {
  const directory = new URL(
    db.dialect === 'postgres' ? './migrations/postgres/' : './migrations/',
    import.meta.url,
  );
  await db
    .transaction(async () => {
      await db.exec(
        'CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
      for (const name of readdirSync(directory)
        .filter((n) => n.endsWith('.sql'))
        .sort()) {
        if (await db.prepare('SELECT 1 FROM migrations WHERE name=?').get(name)) continue;
        await db.exec(readFileSync(new URL(name, directory), 'utf8'));
        await db.prepare('INSERT INTO migrations VALUES (?,?)').run(name, new Date().toISOString());
      }
    })
    .immediate();
}
export async function openDatabase(path: string): Promise<DB> {
  const { default: SQLite } = await import('better-sqlite3');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new SQLite(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 10000');
  sqlite.pragma('secure_delete = ON');
  const db = new DB({
    dialect: 'sqlite',
    serial: true,
    async query(sql, values) {
      if (!values.length && /;|^PRAGMA\b|^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) {
        sqlite.exec(sql);
        return { rows: [], rowCount: 0 };
      }
      const stmt = sqlite.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all(...values);
        return { rows, rowCount: rows.length };
      }
      const result = stmt.run(...values);
      return { rows: [], rowCount: result.changes };
    },
    async close() {
      sqlite.close();
    },
  });
  try {
    await migrateDatabase(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
export async function openPostgres(url: string): Promise<DB> {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslnegotiation'])
    parsed.searchParams.delete(key);
  const pool = new Pool({
    connectionString: parsed.toString(),
    ssl: local ? undefined : { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 20000,
    statement_timeout: 30000,
    types: {
      getTypeParser: (oid, format) =>
        oid === 20 && format !== 'binary' ? safeInteger : types.getTypeParser(oid, format),
    },
  });
  pool.on('error', () =>
    console.error('PostgreSQL connection interrupted. Check database availability.'),
  );
  if (process.env.VERCEL === '1') attachDatabasePool(pool);
  const query = async (client: Pool | import('pg').PoolClient, sql: string, values: unknown[]) => {
    const r = await client.query(sql, values);
    if (Array.isArray(r))
      return {
        rows: r.flatMap((x) => x.rows),
        rowCount: r.reduce((n, x) => n + (x.rowCount || 0), 0),
      };
    return { rows: r.rows, rowCount: r.rowCount || 0 };
  };
  const db = new DB({
    dialect: 'postgres',
    query: (sql, values) => query(pool, sql, values),
    async connect() {
      const client = await pool.connect();
      return {
        query: (sql, values) => query(client, sql, values),
        release: () => client.release(),
      };
    },
    async close() {
      await pool.end();
    },
  });
  try {
    await migrateDatabase(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
export function openConfiguredDatabase(cfg: Config) {
  if (cfg.hosted && !cfg.databaseUrl)
    throw new Error(
      'Set the server-side DATABASE_URL in Vercel. SQLite is only supported locally.',
    );
  return cfg.databaseUrl ? openPostgres(cfg.databaseUrl) : openDatabase(cfg.databasePath);
}
export async function settings(db: DB, cfg: Config): Promise<Settings> {
  const row = (await db.prepare("SELECT value FROM settings WHERE key='integration'").get()) as
    { value: string } | undefined;
  return row
    ? JSON.parse(row.value)
    : {
        mode: cfg.initialMode,
        dataset_id: cfg.datasetId,
        application_name: 'WebM8 CRM',
        event_names: EVENT_NAMES,
        checklist: [
          'Relevant service requirement',
          'Within service area',
          'Confirmed interest',
          'Suitable timeframe',
        ],
      };
}
export async function saveSettings(db: DB, value: Settings) {
  await db
    .transaction(async () => {
      await db
        .prepare(
          "INSERT INTO settings VALUES ('integration',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(value));
    })
    .immediate();
}
