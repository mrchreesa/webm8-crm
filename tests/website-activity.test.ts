import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  leadTime,
  rankVisits,
  visitEvidence,
  type LeadTiming,
  type MeasuredView,
} from '../src/website-activity';
const at = Date.now() - 30_000;
const lead: LeadTiming = {
  id: randomUUID(),
  meta_submitted_at: new Date(at).toISOString(),
  received_at: new Date(at + 10 * 60_000).toISOString(),
  ad_id: '12345678901234567890',
  adset_id: '22222222222222222222',
  campaign_id: '33333333333333333333',
};
function view(delta = 20_000, adId = '', campaignId = ''): MeasuredView {
  return {
    id: randomUUID(),
    visitor_id: randomUUID(),
    session_id: randomUUID(),
    created_at: new Date(at + delta).toISOString(),
    updated_at: new Date(at + delta).toISOString(),
    path: '/demo',
    device: 'mobile',
    active_ms: 5000,
    scroll_depth: 50,
    clicks: {},
    sections: {},
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    referrer_host: '',
    telemetry: {
      journey: {
        startedAt: at - 86400_000,
        visibleMs: 5000,
        clicks: [],
        clicksTruncated: false,
        arrival: {
          source: '',
          sourceName: '',
          medium: '',
          campaign: '',
          campaignId,
          adsetId: '',
          adId,
          hasFbclid: false,
          referrerHost: '',
        },
      },
    },
  };
}
test('use Meta submission time despite delivery delay, and server receipt time despite wrong browser clock', () => {
  assert.equal(leadTime(lead).at, at);
  assert.equal(visitEvidence(lead, view())?.deltaMs, 20_000);
  assert.equal(leadTime({ ...lead, meta_submitted_at: null }).basis, 'CRM receipt');
});
test('bound the timing window and reject a visit that started elsewhere', () => {
  assert.ok(visitEvidence(lead, view(-120_000)));
  assert.ok(visitEvidence(lead, view(600_000)));
  assert.equal(visitEvidence(lead, view(-120_001)), null);
  assert.equal(visitEvidence(lead, view(600_001)), null);
  assert.equal(visitEvidence(lead, { ...view(), path: '/pricing' }), null);
});
test('exact long ad IDs outrank timing; conflicting identifiers remain explicit', () => {
  const exact = view(30_000, lead.ad_id!);
  const timing = view(1_000);
  const conflict = view(2_000, '12345678901234567891', lead.campaign_id!);
  const ranked = rankVisits(lead, [timing, conflict, exact], []);
  assert.deepEqual(
    ranked.map((v) => v.band),
    ['Ad and timing match', 'Instant Form landing · timing only', 'Conflicting ad details'],
  );
  assert.deepEqual(ranked[2].conflicts, ['Ad ID differs from this lead']);
  assert.equal('confidence' in ranked[0], false);
});
test('a single visit can fit several leads; none is made confirmed', () => {
  const other = { ...lead, id: randomUUID() };
  const candidates = rankVisits(
    lead,
    [view(5000, lead.ad_id!)],
    [lead, other, { ...other, id: randomUUID(), ad_id: '99999999999999999999' }],
  );
  assert.equal(candidates[0].competingLeads, 1);
  assert.equal('confirmed' in candidates[0], false);
});
test('a click marker is not an exact lead identifier or paid ad evidence', () => {
  const input = view();
  input.telemetry!.journey!.arrival.hasFbclid = true;
  const result = visitEvidence(lead, input)!;
  assert.equal(result.band, 'Meta arrival near submission');
  assert.ok(result.evidence.some((e) => e.includes('does not identify')));
  assert.equal(result.rank, 0);
});
