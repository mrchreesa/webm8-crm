import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../server/config';
const shared = {
  NODE_ENV: 'production',
  APP_URL: 'https://crm.example.com',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  CRM_WORKSPACE_ID: 'e9737691-054b-4dbb-aac1-b87942b5394d',
};
test('deployed CRM requires shared identity and an explicit workspace, never owner fallback', () => {
  assert.throws(() => getConfig({ ...shared, CRM_AUTH_MODE: 'owner' }), /development-only/);
  assert.throws(() => getConfig({ ...shared, CRM_WORKSPACE_ID: '' }));
  assert.throws(() => getConfig({ ...shared, SUPABASE_PUBLISHABLE_KEY: '' }), /publishable/);
  const cfg = getConfig(shared);
  assert.equal(cfg.workspaceAuth.enabled, true);
  assert.equal(cfg.analyticsUrl, 'https://crm.example.com/app');
});
test('isolated local owner preview remains available without hosted credentials', () => {
  const cfg = getConfig({ NODE_ENV: 'development', CRM_AUTH_MODE: 'owner' });
  assert.equal(cfg.workspaceAuth.enabled, false);
});
