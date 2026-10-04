import { readFileSync } from 'node:fs';
import { getConfig } from '../server/config';
import { openDatabase, openPostgres } from '../server/db';
import { transferSqliteToPostgres } from '../server/database-transfer';

async function main() {
  const cfg = getConfig();
  const fileIndex = process.argv.indexOf('--connection-file');
  const url =
    fileIndex >= 0 ? readFileSync(process.argv[fileIndex + 1], 'utf8').trim() : cfg.databaseUrl;
  if (!url) throw new Error('Set DATABASE_URL on the server or provide a private connection file.');
  const source = await openDatabase(cfg.databasePath);
  try {
    const target = await openPostgres(url);
    try {
      console.log(JSON.stringify(await transferSqliteToPostgres(source, target)));
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}
main().catch(() => {
  console.error(
    'Neon migration failed. Source data is unchanged. Check database access, an empty destination, and stopped services.',
  );
  process.exitCode = 1;
});
