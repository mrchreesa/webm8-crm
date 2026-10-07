import type { SupabaseClient } from '@supabase/supabase-js';
import type { DB } from './db.js';
import type { Config } from './config.js';
import { getLead, AppError } from './leads.js';
import {
  AFTER_MS,
  BEFORE_MS,
  leadTime,
  rankVisits,
  type LeadTiming,
  type MeasuredView,
  type WebsiteActivity,
} from '../src/website-activity.js';
const fields =
  'id,visitor_id,session_id,path,created_at,updated_at,device,active_ms,scroll_depth,clicks,sections,utm_source,utm_medium,utm_campaign,referrer_host,telemetry';
function data<T>(result: { data: T | null; error: unknown }): T {
  if (result.error || result.data === null)
    throw new AppError('Website activity is temporarily unavailable. Try again.', 503);
  return result.data;
}
export async function websiteActivity(
  db: DB,
  cfg: Config,
  client: SupabaseClient | undefined,
  leadId: string,
  options: { visit?: string; page?: number; visits?: number } = {},
): Promise<WebsiteActivity> {
  const lead = await getLead(db, leadId);
  const base = { checkedAt: new Date().toISOString(), candidates: [] };
  if (lead.is_demo || lead.source !== 'meta_instant_form')
    return { ...base, status: 'not_applicable' };
  if (!cfg.analyticsSiteId || !client) return { ...base, status: 'not_configured' };
  const reference = leadTime(lead);
  if (!Number.isFinite(reference.at))
    throw new AppError('This lead has no usable submission time.', 400);
  if (reference.at < Date.now() - 180 * 86400_000) return { ...base, status: 'expired' };
  const sites = data(
    await client
      .from('analytics_sites')
      .select('id,workspace_id,origin')
      .eq('id', cfg.analyticsSiteId)
      .eq('workspace_id', cfg.workspaceAuth.workspaceId)
      .limit(1),
  );
  if (!sites.length)
    throw new AppError('The WebM8 website is not available in this workspace.', 403);
  const from = new Date(reference.at - BEFORE_MS).toISOString(),
    to = new Date(reference.at + AFTER_MS).toISOString();
  const query = () =>
    client
      .from('analytics_pageviews')
      .select(fields)
      .eq('site_id', cfg.analyticsSiteId)
      .eq('workspace_id', cfg.workspaceAuth.workspaceId);
  // Receipt times come from our database. Browser clocks are only used inside a page's timeline.
  const landing = data(
    await query()
      .eq('path', '/demo')
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at')
      .order('id')
      .limit(201),
  ) as MeasuredView[];
  const keys = [
    ...new Map(landing.map((v) => [`${v.visitor_id}:${v.session_id}`, v])).values(),
  ].slice(0, 50);
  const starts: MeasuredView[] = [];
  for (let i = 0; i < keys.length; i += 8) {
    const batch = await Promise.all(
      keys
        .slice(i, i + 8)
        .map((v) =>
          query()
            .eq('visitor_id', v.visitor_id)
            .eq('session_id', v.session_id)
            .order('created_at')
            .order('id')
            .limit(1),
        ),
    );
    for (const result of batch) starts.push(...(data(result) as MeasuredView[]));
  }
  const neighbours = (await db
    .prepare(
      `SELECT id,meta_submitted_at,received_at,ad_id,adset_id,campaign_id FROM leads WHERE source='meta_instant_form' AND is_demo=0 AND COALESCE(meta_submitted_at,received_at)>=? AND COALESCE(meta_submitted_at,received_at)<=? ORDER BY COALESCE(meta_submitted_at,received_at),id LIMIT 201`,
    )
    .all(
      new Date(reference.at - BEFORE_MS - AFTER_MS).toISOString(),
      new Date(reference.at + BEFORE_MS + AFTER_MS).toISOString(),
    )) as LeadTiming[];
  const candidates = rankVisits(lead, starts, neighbours);
  const page = Math.max(1, Math.min(Math.ceil(candidates.length / 5) || 1, options.visits || 1));
  const result: WebsiteActivity = {
    ...base,
    status: 'ready',
    basis: reference.basis,
    referenceAt: new Date(reference.at).toISOString(),
    truncated:
      landing.length > 200 ||
      new Set(landing.map((v) => `${v.visitor_id}:${v.session_id}`)).size > 50 ||
      neighbours.length > 200,
    candidates: candidates.slice((page - 1) * 5, page * 5),
    total: candidates.length,
    page,
  };
  if (options.visit) {
    const selected = candidates.find((v) => v.sessionId === options.visit);
    if (!selected)
      throw new AppError(
        'That visit is not a candidate for this lead. Refresh the possible visits.',
        404,
      );
    const countResult = await client
      .from('analytics_pageviews')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', cfg.analyticsSiteId)
      .eq('workspace_id', cfg.workspaceAuth.workspaceId)
      .eq('visitor_id', selected.visitorId)
      .eq('session_id', selected.sessionId)
      .gte('created_at', new Date(Date.now() - 180 * 86400_000).toISOString());
    if (countResult.error) throw new AppError('The visit could not be loaded. Try again.', 503);
    const total = countResult.count || 0,
      step = Math.max(1, Math.min(Math.ceil(total / 25) || 1, options.page || 1));
    const rows = data(
      await query()
        .eq('visitor_id', selected.visitorId)
        .eq('session_id', selected.sessionId)
        .gte('created_at', new Date(Date.now() - 180 * 86400_000).toISOString())
        .order('created_at')
        .order('id')
        .range((step - 1) * 25, step * 25 - 1),
    ) as MeasuredView[];
    result.selected = {
      sessionId: selected.sessionId,
      rows,
      total,
      page: step,
      analyticsPath: `/app/webm8/websites?site=${encodeURIComponent(cfg.analyticsSiteId)}&from=${from.slice(0, 10)}&to=${new Date(reference.at + 86400_000).toISOString().slice(0, 10)}&visit=${selected.sessionId}#selected-journey`,
    };
  }
  return result;
}
