import type { Options, Store } from 'express-rate-limit';
import type { DB } from './db.js';
import { sha256 } from './matching.js';

// Shared by all web instances; raw client IPs are never stored.
export class LoginLimitStore implements Store {
  localKeys = false;
  private windowMs = 15 * 60000;
  constructor(private db: DB) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  async increment(key: string) {
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + this.windowMs).toISOString();
    const row = await this.db
      .prepare(
        `INSERT INTO login_limits (key_hash,hits,expires_at) VALUES (?,1,?)
      ON CONFLICT(key_hash) DO UPDATE SET
      hits=CASE WHEN login_limits.expires_at<=? THEN 1 ELSE login_limits.hits+1 END,
      expires_at=CASE WHEN login_limits.expires_at<=? THEN ? ELSE login_limits.expires_at END
      RETURNING hits,expires_at`,
      )
      .get(sha256(key), expires, now, now, expires);
    return { totalHits: row.hits as number, resetTime: new Date(row.expires_at) };
  }
  async decrement(key: string) {
    await this.db
      .prepare(
        'UPDATE login_limits SET hits=CASE WHEN hits>0 THEN hits-1 ELSE 0 END WHERE key_hash=?',
      )
      .run(sha256(key));
  }
  async resetKey(key: string) {
    await this.db.prepare('DELETE FROM login_limits WHERE key_hash=?').run(sha256(key));
  }
}
