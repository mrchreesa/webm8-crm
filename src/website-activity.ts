/** Evidence for possible visits, never an identity match or a probability. */
export const BEFORE_MS = 2 * 60_000;
export const AFTER_MS = 10 * 60_000;
export interface LeadTiming {
  id: string;
  meta_submitted_at: string | null;
  received_at: string;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
}
export interface MeasuredView {
  id: string;
  visitor_id: string;
  session_id: string;
  path: string;
  created_at: string;
  updated_at: string;
  device: string;
  active_ms: number;
  scroll_depth: number;
  clicks: Record<string, number>;
  sections: Record<string, number>;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  referrer_host: string;
  telemetry?: {
    journey?: {
      startedAt: number;
      visibleMs: number;
      clicks: { name: string; at: number }[];
      clicksTruncated: boolean;
      arrival: {
        source: string;
        sourceName: string;
        medium: string;
        campaign: string;
        campaignId: string;
        adsetId: string;
        adId: string;
        hasFbclid: boolean;
        referrerHost: string;
      };
    };
  } | null;
}
export function leadTime(lead: LeadTiming) {
  const meta = Date.parse(lead.meta_submitted_at || '');
  return {
    at: Number.isFinite(meta) ? meta : Date.parse(lead.received_at),
    basis: Number.isFinite(meta) ? 'Meta submission' : 'CRM receipt',
  };
}
export function visitEvidence(lead: LeadTiming, view: MeasuredView) {
  const deltaMs = Date.parse(view.created_at) - leadTime(lead).at;
  if (
    !Number.isFinite(deltaMs) ||
    deltaMs < -BEFORE_MS ||
    deltaMs > AFTER_MS ||
    view.path.replace(/\/$/, '') !== '/demo'
  )
    return null;
  const arrival = view.telemetry?.journey?.arrival;
  const evidence: string[] = ['Entered on /demo, WebM8’s designated Instant Form landing page'],
    conflicts: string[] = [];
  let rank = 0;
  for (const [field, label, weight] of [
    ['ad_id', 'Ad ID', 3],
    ['adset_id', 'Ad set ID', 2],
    ['campaign_id', 'Campaign ID', 1],
  ] as const) {
    const value =
      field === 'ad_id'
        ? arrival?.adId
        : field === 'adset_id'
          ? arrival?.adsetId
          : arrival?.campaignId;
    if (lead[field] && value) {
      if (lead[field] === value) {
        evidence.push(`${label} matches the landing URL`);
        rank = Math.max(rank, weight);
      } else conflicts.push(`${label} differs from this lead`);
    }
  }
  const metaSource =
    /^(facebook|instagram|meta|fb|ig|an|msg)$/i.test(arrival?.source || view.utm_source) ||
    /^(fb|ig|an|msg)$/i.test(arrival?.sourceName || '') ||
    /(^|\.)(facebook\.com|instagram\.com|fb\.com|fb\.me)$/i.test(
      arrival?.referrerHost || view.referrer_host,
    );
  if (metaSource) evidence.push('Meta source or referrer');
  if (arrival?.hasFbclid)
    evidence.push('Meta click marker present; it does not identify this lead');
  if (evidence.length === 1) evidence.push('No matching ad identifiers or Meta referrer recorded');
  const band = conflicts.length
    ? 'Conflicting ad details'
    : rank === 3
      ? 'Ad and timing match'
      : rank > 0
        ? 'Campaign and timing match'
        : metaSource || arrival?.hasFbclid
          ? 'Meta arrival near submission'
          : 'Instant Form landing · timing only';
  return {
    deltaMs,
    evidence,
    conflicts,
    band,
    rank: conflicts.length ? -1 : rank * 10 + (metaSource ? 1 : 0),
  };
}
export function rankVisits(lead: LeadTiming, starts: MeasuredView[], neighbours: LeadTiming[]) {
  return starts
    .flatMap((view) => {
      const e = visitEvidence(lead, view);
      if (!e) return [];
      const competingLeads = neighbours.filter(
        (other) =>
          other.id !== lead.id &&
          (() => {
            const match = visitEvidence(other, view);
            return match && !match.conflicts.length;
          })(),
      ).length;
      return [
        {
          sessionId: view.session_id,
          visitorId: view.visitor_id,
          firstReceivedAt: view.created_at,
          device: view.device,
          ...e,
          competingLeads,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        Math.abs(a.deltaMs) - Math.abs(b.deltaMs) ||
        a.sessionId.localeCompare(b.sessionId),
    );
}
export interface WebsiteActivity {
  status: 'ready' | 'not_configured' | 'not_applicable' | 'expired';
  checkedAt: string;
  basis?: string;
  referenceAt?: string;
  truncated?: boolean;
  candidates: ReturnType<typeof rankVisits>;
  total?: number;
  page?: number;
  selected?: {
    sessionId: string;
    rows: MeasuredView[];
    total: number;
    page: number;
    analyticsPath: string;
  };
}
