import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/auth';
import { parse as parseEnv } from 'dotenv';
import { getConfig } from '../server/config';
import { openConfiguredDatabase } from '../server/db';
const args = process.argv.slice(2),
  option = (key: string) => args[args.indexOf(key) + 1];
const generated = randomBytes(15).toString('base64url');
const password = process.env.OWNER_SETUP_PASSWORD || generated;
const email = args.includes('--email') ? option('--email') : 'owner@example.com';
if (password.length < 12) throw new Error('Use an owner password of at least 12 characters.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Use a valid owner email.');
let env = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8');
for (const [key, value] of Object.entries({
  OWNER_EMAIL: email,
  OWNER_PASSWORD_HASH: hashPassword(password),
})) {
  if (new RegExp(`^${key}=.*$`, 'm').test(env))
    env = env.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  else env += `\n${key}=${value}\n`;
}
writeFileSync('.env', env, { mode: 0o600 });
const db = await openConfiguredDatabase(getConfig({ ...process.env, ...parseEnv(env) }));
await db.prepare('DELETE FROM sessions').run();
await db.close();
console.log(`Owner configured: ${email}`);
if (!process.env.OWNER_SETUP_PASSWORD)
  console.log(`Generated owner password (shown once): ${generated}`);
else console.log('Owner password set from OWNER_SETUP_PASSWORD.');
console.log(
  'Saved a salted password hash to .env. Restart the web service after changing owner access.',
);
