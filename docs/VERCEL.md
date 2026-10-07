# Vercel deployment and live release

The Vite interface is served by the CDN. `api/index.ts` runs the Express API and `api/queue.ts` is a private Vercel Queues consumer. PostgreSQL on Neon is the source of truth. Vercel cannot run `npm run worker` continuously, and its filesystem is not persistent storage.

## Configuration

Connect this repository to the existing Vercel project, use the Vite preset, `npm run build`, and output `dist`. `vercel.json` supplies API/SPA routing, London functions, SQL migration files, the private queue trigger, security headers, and daily recovery at 03:00 UTC. Functions require Node 22 or newer.

Add these variables to **Production only**, with secrets marked sensitive:

- `DATABASE_URL`: Neon pooled PostgreSQL URL (TLS required).
- `APP_URL`: the permanent HTTPS origin, currently `https://webm8-crm.vercel.app`.
- `CRM_AUTH_MODE=supabase`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CRM_WORKSPACE_ID`: same identity project as Analytics, bound to the WebM8 workspace. Use the publishable key, never the service key.
- Apply the Analytics shared-session migration and deploy Analytics before CRM; see its `docs/crm-workspace.md`. The old owner password is development-only.
- `META_GRAPH_VERSION=v26.0`, `META_PAGE_ID`, `META_DATASET_ID` (exact text).
- `META_PAGE_ACCESS_TOKEN`, `META_CAPI_ACCESS_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_TEST_EVENT_CODE`.
- `META_INITIAL_MODE=test`, `CRM_QUEUE_ENABLED=true`, `META_LIVE_ENABLED=false`, `TRUST_PROXY=1`.
- `CRON_SECRET`: at least 32 random bytes, kept private. Vercel authenticates cron requests with this bearer token.

Never use `VITE_` for credentials, copy production credentials to Preview, or upload `.env`, `data/`, or backups. `.vercelignore` excludes them. Preview APIs intentionally return 503 and cannot access production lead data or dispatch outcomes. A future interactive preview must have its own isolated database and integration.

Deployments apply additive SQL migrations on first use under a database transaction. Back up before destructive schema changes. The pooled database connection is registered with Vercel's connection lifecycle to close idle connections before suspension. Missing database settings produce an unavailable API, never an ephemeral SQLite fallback.

## Delivery and recovery

A signed webhook is committed to SQL before acknowledgement. Publishing its wakeup fails with 503 so Meta can safely replay the notification. CRM writes stay committed if publication fails; Integration displays the queue error and offers a background check. The independent daily cron also recovers missed wakeups. Hobby cron is imprecise and runs at most daily; it is the recovery mechanism, not the normal delivery scheduler.

Queue messages contain only `{version: 1}`. Each bounded invocation retrieves one lead and delivers one event, then publishes a delayed wakeup for the next eligible SQL job. SQL owns leases, per-lead order, duplicate protection, original event IDs and occurrence times. Temporary failures back off from 30 seconds to six hours. Failed authentication/validation needs an owner retry. A failed earlier stage blocks that lead's later stages, while other leads continue. Old events expire after seven days without changing their time.

Vercel Queues is currently beta. A message can be redelivered; SQL processing is idempotent. Messages retain seven days; the daily recovery scan reschedules remaining SQL work independently. Check Vercel queue/function/cron usage and Neon compute usage; free allowances are finite. The continuously polling local worker is unnecessary once hosted delivery is verified.

CSV and JSON exports stream in batches to avoid buffered response-size limits. A download interrupted by a function timeout or network failure must be restarted. CSV uploads remain capped at 1 MB / 2,000 rows.

## Owner checks before live outcomes

1. Sign in at the permanent URL. Confirm your records, exports, HTTPS callback, configured credentials, and the last hosted background check.
2. Update the existing Meta app's Page `leadgen` webhook callback to `/api/webhooks/meta` on this origin. Keep the same app, Page subscription, permissions and verification token. Meta must verify this callback.
3. Create a fresh lead in Meta's Lead Ads Testing Tool. Verify its signed notification, successful Graph retrieval, exactly one initial New milestone, and **Accepted by Meta** in test mode with the Mac worker stopped.
4. Review the privacy notice for Meta Instant Form data and CRM outcome sharing. Finish dataset/ad-account access, funnel validation, and mapping in Events Manager. Positive targets are Qualified, Appointment Booked and Won; New, Contacted, Lost and Unqualified are feedback stages. Sending events does not finish Meta's account-side validation or select Conversion Leads optimization.
5. Confirm the hosting plan permits the intended use. Vercel Hobby is personal/non-commercial; a business lead/sales CRM needs a permitted commercial plan before live business use. Do not upgrade or incur charges without the owner's approval.
6. With explicit owner approval, set production `META_LIVE_ENABLED=true` and redeploy. Then select Live in Integration, tick its confirmation and save. A server lock alone does not switch mode. Existing demo/test events and test-only records stay excluded from live; outcomes for those leads cannot be promoted. New genuine leads received after live activation use live mode.
7. Record only real outcomes at their actual occurrence time. Check accepted/failed/expired status. Meta acceptance does not establish matching, attribution or active optimization.

To pause dispatch, select Demo in Integration (CRM records remain), or lock `META_LIVE_ENABLED=false` and redeploy if already live. Inbox notifications remain persistent. Review the sync log after restoring configuration and retry only eligible events.

## References

- [Vercel Queues quickstart](https://vercel.com/docs/queues/quickstart), [SDK](https://vercel.com/docs/queues/sdk), [limits](https://vercel.com/docs/queues/pricing).
- [Vercel function limits](https://vercel.com/docs/functions/limitations), [cron plans](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Hobby permitted use](https://vercel.com/docs/plans/hobby).
- [Neon configuration](NEON.md), [Meta owner setup](SETUP.md).
