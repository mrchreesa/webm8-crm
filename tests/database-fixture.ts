import { PGlite } from '@electric-sql/pglite';
import { DB, migrateDatabase, openDatabase, safeInteger } from '../server/db';
export async function openTestDatabase(path: string) {
  if (process.env.CRM_TEST_ENGINE !== 'postgres') return openDatabase(path);
  return openTestPostgres(path);
}
export async function openTestPostgres(path = ':memory:') {
  const pg = new PGlite(path === ':memory:' ? undefined : path + '.postgres');
  const db = new DB({
    dialect: 'postgres',
    serial: true,
    async query(sql, values) {
      if (sql.includes(';') && !values.length) {
        await pg.exec(sql);
        return { rows: [], rowCount: 0 };
      }
      const result = await pg.query<any>(sql, values);
      for (const field of result.fields) {
        if (field.dataTypeID === 20)
          for (const row of result.rows)
            if (row[field.name] !== null) row[field.name] = safeInteger(String(row[field.name]));
      }
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
    },
    async close() {
      await pg.close();
    },
  });
  await migrateDatabase(db);
  return db;
}
