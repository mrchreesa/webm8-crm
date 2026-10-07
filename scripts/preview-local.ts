import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';
import { getConfig } from '../server/config';
import { openConfiguredDatabase } from '../server/db';
import { createApp } from '../server/app';
import { createLead } from '../server/leads';
import { hashPassword } from '../server/auth';

// A dedicated preview database and loopback-only servers. No delivery worker.
const password = randomBytes(12).toString('base64url');
const previewEnv = { ...process.env };
for (const key of Object.keys(previewEnv)) {
  if (/^(META_|TWILIO_|SMS_|OPENPHONE_|VERCEL|CRM_QUEUE_|WEBSITE_INTAKE_|CRON_SECRET)/.test(key))
    previewEnv[key] = '';
}
Object.assign(previewEnv, {
  NODE_ENV: 'development',
  DATABASE_URL: '',
  DATABASE_PATH: './data/local-preview.sqlite',
  PORT: '5175',
  APP_URL: 'http://127.0.0.1:5174',
  OWNER_EMAIL: 'preview@example.com',
  OWNER_NAME: 'Local preview',
  OWNER_PASSWORD_HASH: hashPassword(password),
  META_INITIAL_MODE: 'demo',
  META_LIVE_ENABLED: 'false',
  SMS_ENABLED: 'false',
  TWILIO_VOICE_ENABLED: 'false',
  CRM_QUEUE_ENABLED: 'false',
  VITE_ANALYTICS_URL: 'http://127.0.0.1:3100/app',
  ANALYTICS_UPSTREAM_URL: process.env.ANALYTICS_UPSTREAM_URL || 'http://127.0.0.1:3100',
});
const cfg = getConfig(previewEnv);
const db = await openConfiguredDatabase(cfg);
if (!(await db.prepare('SELECT id FROM leads LIMIT 1').get())) {
  for (const name of ['Demo Emma', 'Demo James', 'Demo Sophie']) {
    await createLead(
      db,
      cfg,
      {
        source: 'demo',
        name,
        email: `${name.split(' ')[1].toLowerCase()}@example.invalid`,
        is_demo: true,
      },
      'Local preview',
    );
  }
}
process.env.NODE_ENV = 'development';
process.env.PORT = '5175';
process.env.VITE_PORT = '5174';
process.env.VITE_ANALYTICS_URL = cfg.analyticsUrl;
process.env.CRM_AUTH_MODE = cfg.workspaceAuth.enabled ? 'supabase' : 'owner';
process.env.ANALYTICS_UPSTREAM_URL = previewEnv.ANALYTICS_UPSTREAM_URL;
const api = createApp(db, cfg).listen(5175, '127.0.0.1');
const web = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
await web.listen();
console.log(
  `Local CRM preview: http://127.0.0.1:5174\n${cfg.workspaceAuth.enabled ? 'Sign in with your existing Analytics account.' : `Email: preview@example.com\nPassword: ${password}`}\nSynthetic CRM data. Analytics uses its existing configured data.`,
);
let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  await web.close();
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await db.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
