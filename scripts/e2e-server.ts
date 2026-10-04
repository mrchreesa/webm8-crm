import { rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { openConfiguredDatabase } from '../server/db';
import { getConfig } from '../server/config';
import { createLead } from '../server/leads';
import { hashPassword } from '../server/auth';
process.env.DATABASE_URL = '';
process.env.DATABASE_PATH = './data/e2e.sqlite';
process.env.NODE_ENV = 'development';
process.env.PORT = '5186';
process.env.VITE_PORT = '5185';
process.env.APP_URL = 'http://127.0.0.1:5185';
process.env.OWNER_EMAIL = 'test@example.com';
process.env.OWNER_PASSWORD_HASH = hashPassword('test-owner-password');
process.env.META_INITIAL_MODE = 'demo';
for (const key of [
  'META_PAGE_ACCESS_TOKEN',
  'META_CAPI_ACCESS_TOKEN',
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'META_PAGE_ID',
  'META_DATASET_ID',
  'META_TEST_EVENT_CODE',
])
  process.env[key] = '';
for (const ext of ['', '-wal', '-shm']) rmSync('./data/e2e.sqlite' + ext, { force: true });
const cfg = getConfig(),
  db = await openConfiguredDatabase(cfg);
for (let i = 0; i < 3; i++)
  await createLead(
    db,
    cfg,
    {
      source: 'demo',
      name: ['Demo Emma', 'Demo James', 'Demo Sophie'][i],
      email: `demo${i}@example.com`,
      is_demo: true,
    },
    'Demo',
  );
await db.close();
const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit', env: process.env });
const stop = () => {
  child.kill('SIGTERM');
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code || 0));
