import 'dotenv/config';
import { z } from 'zod';
export interface Config {
  port: number;
  databasePath: string;
  databaseUrl: string;
  appUrl: string;
  ownerEmail: string;
  ownerName: string;
  passwordHash: string;
  production: boolean;
  graphVersion: string;
  initialMode: 'demo' | 'test';
  datasetId: string;
  pageId: string;
  pageToken: string;
  capiToken: string;
  appSecret: string;
  verifyToken: string;
  testEventCode: string;
  workerInterval: number;
  trustProxy: number;
}
export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const graphVersion = env.META_GRAPH_VERSION || 'v26.0';
  if (!/^v\d+\.0$/.test(graphVersion)) throw new Error('META_GRAPH_VERSION must use vNN.0 format.');
  const parsedUrl = new URL(
    z
      .url()
      .parse(env.APP_URL || 'http://localhost:5174')
      .replace(/\/$/, ''),
  );
  if (
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.username ||
    parsedUrl.password
  )
    throw new Error(
      'APP_URL must be the application origin, without a path, query or credentials.',
    );
  const appUrl = parsedUrl.origin;
  const production = env.NODE_ENV === 'production';
  if (production && !appUrl.startsWith('https://'))
    throw new Error('Production APP_URL must use HTTPS.');
  for (const key of ['META_PAGE_ID', 'META_DATASET_ID']) {
    if (env[key] && !/^[1-9]\d{4,39}$/.test(env[key]!))
      throw new Error(`${key} must be an exact digit string.`);
  }
  return {
    port: Number(env.PORT || 3001),
    databasePath: env.DATABASE_PATH || './data/crm.sqlite',
    databaseUrl: env.DATABASE_URL || '',
    appUrl,
    ownerEmail: env.OWNER_EMAIL || 'owner@example.com',
    ownerName: env.OWNER_NAME || 'Business owner',
    passwordHash: env.OWNER_PASSWORD_HASH || '',
    production,
    graphVersion,
    initialMode: env.META_INITIAL_MODE === 'test' ? 'test' : 'demo',
    datasetId: env.META_DATASET_ID || '',
    pageId: env.META_PAGE_ID || '',
    pageToken: env.META_PAGE_ACCESS_TOKEN || '',
    capiToken: env.META_CAPI_ACCESS_TOKEN || '',
    appSecret: env.META_APP_SECRET || '',
    verifyToken: env.META_VERIFY_TOKEN || '',
    testEventCode: env.META_TEST_EVENT_CODE || '',
    workerInterval: Math.max(500, Number(env.WORKER_INTERVAL_MS || 3000)),
    trustProxy: Number(env.TRUST_PROXY || 0),
  };
}
