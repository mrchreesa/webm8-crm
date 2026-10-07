import 'dotenv/config';
import { z } from 'zod';
import { resolveAnalyticsUrl } from '../src/analytics-config.js';
export interface Config {
  port: number;
  databasePath: string;
  databaseUrl: string;
  appUrl: string;
  analyticsUrl: string;
  workspaceAuth: { enabled: boolean; url: string; publishableKey: string; workspaceId: string };
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
  hosted: boolean;
  deployment: string;
  queueEnabled: boolean;
  cronSecret: string;
  allowLive: boolean;
  websiteIntakeSecret: string;
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
  const unified = env.CRM_AUTH_MODE === 'supabase' || production;
  if (production && env.CRM_AUTH_MODE === 'owner')
    throw new Error('Owner-password login is development-only. Configure shared Supabase access.');
  if (env.CRM_AUTH_MODE && !['supabase', 'owner'].includes(env.CRM_AUTH_MODE))
    throw new Error('CRM_AUTH_MODE must be supabase or owner.');
  if (unified) {
    const url = new URL(env.SUPABASE_URL || '');
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        !production &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      )
    )
      throw new Error('SUPABASE_URL must use HTTPS or development loopback.');
    z.uuid().parse(env.CRM_WORKSPACE_ID);
    if (!env.SUPABASE_PUBLISHABLE_KEY)
      throw new Error('Unified login requires the Supabase publishable key.');
  }

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
    analyticsUrl: unified ? `${appUrl}/app` : resolveAnalyticsUrl(env.VITE_ANALYTICS_URL),
    workspaceAuth: {
      enabled: unified,
      url: env.SUPABASE_URL || '',
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY || '',
      workspaceId: env.CRM_WORKSPACE_ID || '',
    },
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
    trustProxy: Number(env.TRUST_PROXY || (env.VERCEL ? 1 : 0)),
    hosted: env.VERCEL === '1',
    deployment: env.VERCEL_ENV || 'local',
    queueEnabled: env.CRM_QUEUE_ENABLED === 'true',
    cronSecret: env.CRON_SECRET || '',
    websiteIntakeSecret: env.WEBSITE_INTAKE_SECRET || '',
    allowLive:
      env.VERCEL === '1' || env.META_LIVE_ENABLED !== undefined
        ? env.META_LIVE_ENABLED === 'true'
        : true,
  };
}
