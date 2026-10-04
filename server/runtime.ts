import { getConfig } from './config.js';
import { openConfiguredDatabase } from './db.js';
import { createApp } from './app.js';

let runtime: ReturnType<typeof buildRuntime> | undefined;
async function buildRuntime() {
  const cfg = getConfig();
  if (cfg.hosted && cfg.deployment !== 'production')
    throw new Error(
      'Preview is isolated. Use a separate test database before enabling preview APIs.',
    );
  const db = await openConfiguredDatabase(cfg);
  return { cfg, db, app: createApp(db, cfg) };
}
export function getRuntime() {
  // Reset after startup failure so a transient database outage can recover.
  return (runtime ||= buildRuntime().catch((error) => {
    runtime = undefined;
    throw error;
  }));
}
