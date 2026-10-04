import type { DB } from './db';
import { sha256 } from './matching';

const tables = [
  'settings',
  'leads',
  'stage_history',
  'milestones',
  'notes',
  'outbox',
  'inbox',
  'sessions',
  'deleted_leads',
  'imports',
] as const;
function canonical(rows: Record<string, unknown>[]) {
  return JSON.stringify(
    rows
      .map((row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

// Stop web and worker before taking the source snapshot. This copies records rather
// than creating milestones, so accepted events can never be generated again.
export async function transferSqliteToPostgres(source: DB, target: DB) {
  if (source.dialect !== 'sqlite' || target.dialect !== 'postgres')
    throw new Error('Transfer requires a SQLite source and PostgreSQL destination.');
  const snapshot = await source
    .transaction(async () => {
      const data: Record<string, Record<string, unknown>[]> = {};
      for (const table of tables)
        data[table] = await source.prepare(`SELECT * FROM ${table}`).all();
      if (
        data.outbox.some((row) => row.status === 'processing') ||
        data.inbox.some((row) => row.status === 'processing')
      )
        throw new Error('Wait for active deliveries and retrievals to finish before migrating.');
      return data;
    })
    .immediate();
  const fingerprint = sha256(
    canonical(Object.entries(snapshot).map(([table, rows]) => ({ table, rows }))),
  );
  return target
    .transaction(async () => {
      const previous = await target
        .prepare("SELECT value FROM settings WHERE key='sqlite_migration'")
        .get();
      if (previous) {
        if (JSON.parse(previous.value).fingerprint !== fingerprint)
          throw new Error('This destination contains a different migration. Use a fresh database.');
        return {
          already_migrated: true,
          counts: Object.fromEntries(tables.map((table) => [table, snapshot[table].length])),
        };
      }
      for (const table of tables) {
        if ((await target.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n !== 0)
          throw new Error(
            'The destination must be empty. No existing destination data was changed.',
          );
      }
      for (const table of tables) {
        for (const row of snapshot[table]) {
          const keys = Object.keys(row);
          await target
            .prepare(
              `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
            )
            .run(...Object.values(row));
        }
        const copied = await target.prepare(`SELECT * FROM ${table}`).all();
        if (canonical(copied) !== canonical(snapshot[table]))
          throw new Error(
            'Database transfer verification failed. All copied records have been rolled back.',
          );
      }
      for (const table of ['stage_history', 'outbox', 'inbox']) {
        await target.exec(
          `SELECT setval(pg_get_serial_sequence('${table}','seq'), GREATEST(COALESCE(MAX(seq),0),1), MAX(seq) IS NOT NULL) FROM ${table}`,
        );
      }
      await target
        .prepare("INSERT INTO settings VALUES ('sqlite_migration',?)")
        .run(JSON.stringify({ fingerprint, migrated_at: new Date().toISOString() }));
      return {
        already_migrated: false,
        counts: Object.fromEntries(tables.map((table) => [table, snapshot[table].length])),
      };
    })
    .immediate();
}
