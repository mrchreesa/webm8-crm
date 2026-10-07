import { workspaceSession, WorkspaceAuthError } from './workspace-auth.js';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DB } from './db.js';
import type { Config } from './config.js';
import { sha256 } from './matching.js';
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  try {
    const [scheme, salt, hash] = encoded.split(':');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'hex'),
      actual = scryptSync(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
export async function createSession(db: DB, cfg: Config, res: Response) {
  const token = randomBytes(32).toString('hex'),
    csrf = randomBytes(32).toString('hex');
  await db
    .prepare(
      'INSERT INTO sessions (token_hash,csrf_token,expires_at,owner_fingerprint) VALUES (?,?,?,?)',
    )
    .run(
      sha256(token),
      csrf,
      new Date(Date.now() + 12 * 3600000).toISOString(),
      sha256(cfg.ownerEmail.toLowerCase() + ':' + cfg.passwordHash),
    );
  res.cookie('crm_session', token, {
    httpOnly: true,
    secure: cfg.production,
    sameSite: 'strict',
    path: '/',
    maxAge: 12 * 3600000,
  });
  return { csrf_token: csrf, owner: { name: cfg.ownerName, email: cfg.ownerEmail } };
}
export async function session(db: DB, cfg: Config, req: Request) {
  const token = req.cookies?.crm_session;
  return typeof token === 'string'
    ? ((await db
        .prepare(
          'SELECT csrf_token FROM sessions WHERE token_hash=? AND expires_at>? AND owner_fingerprint=?',
        )
        .get(
          sha256(token),
          new Date().toISOString(),
          sha256(cfg.ownerEmail.toLowerCase() + ':' + cfg.passwordHash),
        )) as { csrf_token: string } | undefined)
    : undefined;
}
export function requireOwner(db: DB, cfg: Config) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let s;
    try {
      s = cfg.workspaceAuth.enabled
        ? await workspaceSession(cfg, req, res)
        : await session(db, cfg, req);
    } catch (error) {
      if (error instanceof WorkspaceAuthError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      res.status(503).json({ error: 'Workspace access is temporarily unavailable.' });
      return;
    }
    if (!s) {
      res.status(401).json({ error: 'Sign in to access your CRM.' });
      return;
    }
    res.locals.session = s;
    next();
  };
}
export function requireSameOrigin(cfg: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    if (req.headers.origin !== new URL(cfg.appUrl).origin) {
      res.status(403).json({ error: 'This request must come from the CRM application.' });
      return;
    }
    next();
  };
}
export function requireCSRF(req: Request, res: Response, next: NextFunction) {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers['x-csrf-token'] !== res.locals.session.csrf_token
  ) {
    res.status(403).json({ error: 'Your session could not be verified. Refresh and try again.' });
    return;
  }
  next();
}
