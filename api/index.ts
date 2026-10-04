import type { Request, Response } from 'express';
import { getRuntime } from '../server/runtime.js';

export default async function handler(req: Request, res: Response) {
  try {
    const { app } = await getRuntime();
    return app(req, res);
  } catch {
    res.status(503).set('Cache-Control', 'no-store').json({
      error:
        'CRM server is unavailable. Check the production database and server environment configuration. Preview APIs are isolated.',
    });
  }
}
