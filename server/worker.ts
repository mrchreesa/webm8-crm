import { getConfig } from './config';
import { openConfiguredDatabase } from './db';
import { retrieveOne } from './meta';
import { deliverOne, expireEvents } from './outbox';
const cfg = getConfig(),
  db = await openConfiguredDatabase(cfg);
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
console.log('CRM worker running. Persistent inbox and outbox enabled.');
while (!stopping) {
  try {
    await db
      .prepare(
        'INSERT INTO worker_health VALUES (1,?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at',
      )
      .run(new Date().toISOString());
    await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date().toISOString());
    await db.prepare('DELETE FROM login_limits WHERE expires_at<=?').run(new Date().toISOString());
    await expireEvents(db);
    // Separate queues: a retrieval outage does not starve existing CRM outcomes.
    const retrieved = await retrieveOne(db, cfg),
      delivered = await deliverOne(db, cfg);
    if (!retrieved && !delivered)
      await new Promise((resolve) => setTimeout(resolve, cfg.workerInterval));
  } catch {
    console.error('Worker cycle failed. Check database availability. Retrying next cycle.');
    await new Promise((resolve) => setTimeout(resolve, cfg.workerInterval));
  }
}
await db.close();
