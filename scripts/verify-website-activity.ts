/** Uses disposable Analytics accounts/sites and an isolated CRM database. Sends no messages or Meta events. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { openDatabase } from '../server/db.js';
import { getConfig } from '../server/config.js';
import { createLead } from '../server/leads.js';
import { websiteActivity } from '../server/website-activity.js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  secret = process.env.SUPABASE_SECRET_KEY!;
if (!url || !key || !secret) throw new Error('Supply the Analytics Supabase configuration.');
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const viewer = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const outsider = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const workspace = randomUUID(),
  site = randomUUID(),
  otherSite = randomUUID(),
  foreignWorkspace = randomUUID();
const users: string[] = [];
const db = await openDatabase(':memory:');
async function checked(query: any) {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
try {
  for (const client of [viewer, outsider]) {
    const email = `measurement-${randomUUID()}@example.invalid`,
      password = `Test-${randomUUID()}!a7`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error) throw made.error;
    users.push(made.data.user.id);
    await checked(client.auth.signInWithPassword({ email, password }));
  }
  await checked(
    admin.from('workspaces').insert([
      { id: workspace, name: 'Disposable activity verification', slug: `verify-${workspace}` },
      {
        id: foreignWorkspace,
        name: 'Disposable other workspace',
        slug: `verify-${foreignWorkspace}`,
      },
    ]),
  );
  await checked(
    admin.from('workspace_memberships').insert([
      { workspace_id: workspace, user_id: users[0], role: 'manager' },
      { workspace_id: foreignWorkspace, user_id: users[1], role: 'manager' },
    ]),
  );
  await checked(
    admin.from('analytics_sites').insert([
      {
        id: site,
        workspace_id: workspace,
        name: 'Disposable website',
        origin: 'https://www.webm8agency.com',
        allowed_origins: ['https://www.webm8agency.com'],
      },
      {
        id: otherSite,
        workspace_id: foreignWorkspace,
        name: 'Other website',
        origin: 'https://example.org',
        allowed_origins: ['https://example.org'],
      },
    ]),
  );
  const cfg = getConfig({ CRM_ANALYTICS_SITE_ID: site });
  cfg.workspaceAuth.workspaceId = workspace;
  const at = new Date(Date.now() - 10_000).toISOString();
  const input = {
    source: 'meta_instant_form' as const,
    name: 'Synthetic lead',
    meta_lead_id: '98765432109876543',
    page_id: '12345678901',
    form_id: '23456789012',
    ad_id: '34567890123456789',
    campaign_id: '45678901234567890',
    meta_submitted_at: at,
  };
  const lead = (await createLead(db, cfg, input, 'Isolated verification')).lead;
  await createLead(
    db,
    cfg,
    { ...input, meta_lead_id: '98765432109876544' },
    'Isolated verification',
  );
  const sessionId = randomUUID(),
    visitorId = randomUUID();
  const snapshot = {
    viewId: randomUUID(),
    visitorId,
    sessionId,
    path: '/demo',
    referrer: 'https://www.facebook.com/',
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'verification',
    device: 'mobile',
    activeMs: 3000,
    scrollDepth: 55,
    sections: {},
    clicks: { 'demo-deck / demo-card-1': 1 },
    events: {},
    telemetry: {
      version: 2,
      revision: 1,
      timeline: [],
      errors: {},
      vitals: {},
      truncated: false,
      journey: {
        startedAt: Date.now(),
        visibleMs: 3000,
        clicks: [{ name: 'demo-deck / demo-card-1', at: Date.now() }],
        clicksTruncated: false,
        arrival: {
          source: 'facebook',
          medium: 'paid_social',
          campaign: 'verification',
          campaignId: input.campaign_id,
          adId: input.ad_id,
          capturedAt: Date.now(),
          landingPath: '/demo',
          referrerHost: 'www.facebook.com',
        },
      },
    },
  };
  (snapshot.telemetry.journey as any).firstTouch = snapshot.telemetry.journey.arrival;
  const collector = await fetch(`https://webm8-platform.vercel.app/api/analytics/collect/${site}`, {
    method: 'POST',
    headers: { Origin: 'https://www.webm8agency.com', 'Content-Type': 'text/plain' },
    body: JSON.stringify(snapshot),
  });
  assert.equal(collector.status, 204);
  const list = await websiteActivity(db, cfg, viewer, lead.id);
  assert.equal(list.candidates.length, 1);
  assert.equal(list.candidates[0].band, 'Ad and timing match');
  assert.equal(list.candidates[0].competingLeads, 1);
  const detail = await websiteActivity(db, cfg, viewer, lead.id, { visit: sessionId });
  assert.equal(detail.selected?.rows[0].clicks['demo-deck / demo-card-1'], 1);
  assert.equal(detail.selected?.rows[0].active_ms, 3000);
  await assert.rejects(websiteActivity(db, cfg, outsider, lead.id), /not available/);
  await assert.rejects(
    websiteActivity(db, cfg, viewer, lead.id, { visit: randomUUID() }),
    /not a candidate/,
  );
  // A revisit to /demo within the window must not disguise a session that began earlier elsewhere.
  const oldSession = randomUUID();
  await checked(
    admin.from('analytics_pageviews').insert([
      {
        id: randomUUID(),
        site_id: site,
        workspace_id: workspace,
        visitor_id: visitorId,
        session_id: oldSession,
        path: '/pricing',
        device: 'mobile',
        created_at: new Date(Date.now() - 3600_000).toISOString(),
      },
      {
        id: randomUUID(),
        site_id: site,
        workspace_id: workspace,
        visitor_id: visitorId,
        session_id: oldSession,
        path: '/demo',
        device: 'mobile',
        created_at: new Date().toISOString(),
      },
    ]),
  );
  assert.equal((await websiteActivity(db, cfg, viewer, lead.id)).candidates.length, 1);
  console.log(
    'PASS: live collector → Analytics storage → CRM candidate and click timeline; competing leads, session boundaries, foreign workspace and arbitrary visit rejection.',
  );
} finally {
  await db.close();
  const removed = await admin.from('workspaces').delete().in('id', [workspace, foreignWorkspace]);
  if (removed.error) throw new Error('Disposable workspace cleanup failed.');
  for (const id of users) {
    const r = await admin.auth.admin.deleteUser(id);
    if (r.error) throw new Error('Disposable account cleanup failed.');
  }
  console.log(
    'CLEANUP: all temporary accounts, sites, page views and isolated CRM records removed.',
  );
}
