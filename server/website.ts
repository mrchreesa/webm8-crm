import { z } from 'zod';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { createLead } from './leads.js';

const value = z.string().max(500);
export const websiteSubmission = z.object({
  submissionKey: z.uuid(),
  name: z.string().trim().min(1).max(120),
  business: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  phone: z.string().min(7).max(40),
  // The /free-demo/ form stopped asking for an area; older submissions still send one.
  area: z.string().max(120).optional(),
  trade: z.string().min(1).max(80),
  tradeOther: z.string().max(80).nullable(),
  link: value.nullable(),
  attribution: z.record(z.string().max(50), value).refine((v) => Object.keys(v).length <= 20),
  referrer: z.string().max(1000).nullable(),
  pagePath: z.string().max(200).nullable(),
});

export async function receiveWebsiteLead(db: DB, cfg: Config, input: unknown) {
  const data = websiteSubmission.parse(input);
  const answers = Object.entries({
    business_name: data.business,
    business_type: data.trade,
    business_type_other: data.tradeOther,
    service_area: data.area,
    website: data.link,
    page_path: data.pagePath,
    referrer: data.referrer,
    ...data.attribution,
  })
    .filter(([, value]) => value != null && value !== '')
    .map(([name, value]) => ({ name, values: [value!] }));
  return createLead(
    db,
    cfg,
    {
      // Direct website enquiries do not have a Meta Instant Form identity.
      // The explicit website key preserves their origin and makes retries idempotent.
      source: 'manual',
      website_submission_key: data.submissionKey,
      form_name: 'Website demo',
      name: data.name,
      email: data.email,
      phone: data.phone,
      form_answers: answers,
    },
    'WebM8 website',
  );
}
