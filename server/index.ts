import { getConfig } from './config';
import { openConfiguredDatabase } from './db';
import { createApp } from './app';
const cfg = getConfig(),
  db = await openConfiguredDatabase(cfg);
const server = createApp(db, cfg).listen(cfg.port, '0.0.0.0', () =>
  console.log(`CRM listening on port ${cfg.port}. Owner authentication required.`),
);
process.on('SIGTERM', () =>
  server.close(async () => {
    await db.close();
    process.exit(0);
  }),
);
process.on('SIGINT', () =>
  server.close(async () => {
    await db.close();
    process.exit(0);
  }),
);
