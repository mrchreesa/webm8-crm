# Verification report

Verified on 4 October 2026 (Europe/London) with Node.js 22.22.0. Automated tests use isolated databases and mocked Graph API responses; no test dispatches to Meta.

## Results

- 37 server/domain/migration/hosted-queue tests passed (`npm test`): the CRM suite on SQLite, plus PostgreSQL transfer tests.
- 32 CRM tests passed against PostgreSQL through PGlite (`npm run test:postgres`).
- Real Neon TLS connection, cross-connection write locking and rollback passed; application migration and authenticated HTTP checks passed.
- 6 browser tests passed (`npm run test:e2e`).
- TypeScript checks and production build passed.
- Formatting checks and strict premium UI audit passed.
- Browser accessibility scans of Overview and Integration reported no violations. Desktop and mobile layouts were inspected; the mobile document has no horizontal overflow.

## Acceptance evidence

| Requirement                     | Verification                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent leads                | Close and reopen the SQLite and PostgreSQL test databases; lead, history and queued event survive.                                                                                                      |
| Duplicate webhook               | Repeated valid signed notification and retrieval create one lead and one New milestone.                                                                                                                 |
| Exact 17-digit Meta ID          | Numeric webhook JSON is parsed losslessly; Graph retrieval, SQLite/PostgreSQL, CSV/JSON exports and CAPI serialization retain every digit.                                                              |
| Stage changes                   | Genuine changes create history, milestones and the correct mapped event atomically. Forced outbox insertion failure rolls back the stage change.                                                        |
| No incidental conversions       | Same-stage saves, notes and contact edits create no events; repeated positive milestones create history without duplicate conversions.                                                                  |
| Stable retries                  | Temporary failures and explicit retry reuse the event ID, original event time and matching payload.                                                                                                     |
| Matching identifiers            | Email trimming/lowercasing, UK/international phone normalization and single SHA-256 hashing are tested centrally. Retrieval preserves Meta email and email_address fields. Meta lead ID stays unhashed. |
| Webhook authentication          | Invalid signatures are rejected; valid notifications are persisted before acknowledgement.                                                                                                              |
| Mode and origin safety          | Synthetic, manual and test-only leads cannot dispatch live. Delayed retrieval preserves test origin. Live mode needs an explicit authenticated action and configuration.                                |
| Historical expiry               | Old CSV milestones retain actual dates and expire; queued events age out without changing their timestamps.                                                                                             |
| Visible and recoverable failure | Authentication/validation failures retain actionable status; configuration repair and retry recover them. Per-lead order is preserved while another lead can proceed.                                   |
| Honest disconnection            | Missing credentials show an unconfigured integration and never claim accepted delivery.                                                                                                                 |

Browser coverage includes creating, qualifying, editing, noting, exporting and deleting a manual lead; CSV mapping/preview/import; search and filters; keyboard dialogs; preserved drafts and navigation guards; session expiry and reauthentication; loading/error recovery; demo labels; and Sync log inspection. Owner password/email rotation invalidates stored sessions. Lead deletion removes associated personal records and prevents webhook resurrection.

## Real Meta test evidence

The owner authorized the dedicated WebM8 CRM app and supplied credentials through Meta's own interfaces. Credentials are stored only in the private server environment; neither credentials nor lead contact details are included in this report.

- Meta verified the public HTTPS Page webhook callback. The app subscribes to `leadgen` at `v26.0`; a Graph API read confirmed the specific WebM8 Page subscribes to WebM8 CRM app `2410704026403835` with `leadgen` enabled.
- A real Graph API request retrieved genuine Meta verification lead `1142478484781066` from form `1779745316504576`. Its original submission time, source identifiers, contact fields and answers were preserved. The record is test-only, with no invented qualification, appointment or sale.
- The lead was deliberately imported through Graph API using the CRM's transactional creation path. This was **not** a provider-delivered signed webhook notification. The initial New milestone reflects first receipt into this CRM, not a changed historical submission time.
- The persistent worker delivered `CRM_NewLead` in Meta test mode. Meta accepted it on the first attempt at `2026-10-03T21:33:30.807Z`. Event ID: `52974356-9648-4d1a-a4a7-9427d4571857`; original event time: `1791063208`; response trace ID: `AxXGt6yPquO82zlc4EkILzp`. The outgoing payload used the exact string lead ID and normalized, SHA-256 hashed email and phone.
- After server credentials were configured, the public callback rejected an invalid POST signature with HTTP `401` and created no lead.
- After publication and an owner-approved reset of the existing Meta testing slot, Meta's Lead Ads Testing Tool created lead `2334131110463473` for the actual WebM8 form. Meta sent its signed notification to the public callback at `2026-10-03T21:51:02.513Z`. The persistent inbox saved it, and the worker retrieved it on its first attempt. Original submission: `2026-10-03T21:50:59.000Z`; CRM receipt and genuine New milestone: `2026-10-03T21:51:05.254Z`; history actor: `Meta webhook`. The original lead, Page and form IDs remain exact strings.
- The worker sent this lead's `CRM_NewLead` in test mode and Meta accepted it at `2026-10-03T21:51:05.866Z`, first attempt. Event ID: `7649a512-471a-4024-8eb5-b90bc8098714`; actual event time: `1791064265`; response trace ID: `A9fIPNXK82lYjNic5mfWBeD`. The testing tool's Track status table reports **Success — Successful webhook integration** for app `2410704026403835`.
- The owner-facing Sync log was inspected over public HTTPS after authentication: both New events are visibly **Accepted by Meta**, Test mode, one attempt, no errors. Integration shows configured server credentials and a running background worker.
- Synthetic demo records were removed. The current database contains two genuine Meta test leads and two accepted New events, with no invented positive outcomes. After restarting both web and worker, the first lead and acceptance survived with the same event ID, timestamp and single attempt; public health returned HTTP 200 and the worker resumed its heartbeat.

## Neon cutover evidence

The owner approved a free Neon project, WebM8 CRM (`green-poetry-45355974`), in AWS London using PostgreSQL 18. Server credentials are stored only in the private `.env` as `DATABASE_URL`. A private online SQLite backup was made before cutover. Web and worker were stopped, and the transfer verified every copied record before committing. Existing Meta test mode, lead IDs, original payloads, stage/milestone UUIDs, event IDs, event times, accepted-at timestamps and attempt counts were preserved. No Meta events were generated by the transfer.

The live application now reads/writes Neon. An authenticated HTTP check at `2026-10-03T22:59:35.668Z` (4 October in London) confirmed two genuine test leads, zero demo leads, two accepted events with unchanged IDs/times/single attempts, no positive milestones, exact CSV/JSON IDs, a running worker and public health HTTP 200. Replaying an existing notification with a valid locally generated signature returned HTTP 200 without adding a lead or event. An invalid signature returned HTTP 401. This replay is distinct from a fresh provider-delivered Meta webhook; the original genuine delivery evidence remains above.

Migration tests verify copied notes/history, accepted event identity, test mode, identity sequence continuation, identical-run detection and refusal to overwrite a populated destination. Concurrency tests verify duplicate imports, stale stage conflicts, per-lead claims and shared login limits. Real Neon validation used two separate pooled connections; a synthetic diagnostic write was rolled back, with no lead records created.

## Outstanding external checks

The signed webhook → persistent inbox → Graph retrieval → atomic New milestone/outbox → background CAPI delivery loop has passed with a genuine Meta test lead. **Live CAPI delivery and ordinary customer submissions have not been tested.** The app is Published with owner approval; the owner explicitly chose to keep delivery in test mode until permanent hosting is ready. Live remains disabled. Existing test-only leads must never be promoted to Live.

The existing WebM8 privacy policy URL is saved in app settings. Review its description of website enquiries for the actual Meta lead/outcome processing before live use. The dataset's Meta sales funnel, validation and advertising configuration remain outstanding; permanent Vercel hosting is verified below. Events Manager's CRM verification/funnel workflow is distinct from the API's accepted test response; do not claim that workflow is complete.

Only initial receipt has been sent for the genuine lead. Subsequent stage delivery is covered by automated tests; real stage events should be sent when actual business milestones occur. API acceptance does not establish matching, attribution, funnel validation or advertising eligibility. These and the dataset's sales funnel remain account-side checks described in [the setup guide](SETUP.md).

The Docker/Compose deployment configuration was inspected but could not be executed because Docker is unavailable in this workspace. Verify deployment health checks, HTTPS, volume persistence and supervised worker restart on the chosen host. The local web application and separate worker were run successfully.

The latest production build completes successfully without a bundle-size advisory. Design-token lint has no errors and reports unused optional component tokens.

## Permanent Vercel deployment (4 October 2026)

The original deployment served only Vite files: API, authentication, webhook and deep-link paths returned 404. The repaired deployment serves CDN assets and SPA deep links, the authenticated Express API, and a private queue consumer. Neon remains the same persistent database; no original records or accepted events were recreated. Two additional leads arrived before the migration to the permanent callback, and were preserved along with the original two verification records.

- Production variables were absent initially. Database, owner access and Meta configuration were installed server-side, with sensitive values protected. Preview has no production credentials and its API refuses production access. Credentials and private files were checked against tracked source and CDN assets.
- Hosted `health`, owner session, Integration and Overview return 200; unauthenticated lead endpoints remain protected. Invalid webhook signatures return 401. Signed duplicate replay returns 200 and does not create a second lead/milestone. Both CSV and JSON export preserve exact string IDs. Exports now stream in bounded batches; dashboard totals use SQL aggregates.
- The Mac worker was stopped before the hosted check. A private queue wakeup completed successfully, and the authenticated daily recovery endpoint returned 200. SQL leases and retries are additionally covered by PostgreSQL queue tests, including failed publication, duplicate redelivery, delayed retry, actionable failure repair, stable identity and live lock.
- Meta verified the permanent callback `https://webm8-crm.vercel.app/api/webhooks/meta` on WebM8 CRM app `2410704026403835`. Its subscription remains Page `leadgen` at `v26.0`.
- With owner approval, Meta's test slot was reset and a new genuine Meta test lead `1608903124054839` was created. Meta's Testing Tool reports **Success / Successful webhook integration** for this app. Its signed notification was received at `2026-10-04T09:26:27.833Z`, Graph retrieval completed on attempt one, and a single `CRM_NewLead` event was **Accepted by Meta** at `2026-10-04T09:26:30.070Z` on attempt one. Event ID `a216cec2-513c-44e5-af52-420f4a8275b8`, original event time `1791105989`, mode **test**. Intake/retrieval/delivery completed on Vercel without the Mac worker.
- At this check, there are five lead records and five accepted initial test events, zero demo records, no positive milestones and no sales invented. Acceptance status does not establish matching, attribution, optimization eligibility or completed Meta funnel validation.
- `META_LIVE_ENABLED=false` remains a server-side lock; Integration stays in test mode. Commercial hosting plan eligibility, privacy review, Meta funnel/advertising configuration, explicit live approval and the first real live outcome remain outstanding. See [Vercel live release](VERCEL.md).

Screenshot evidence is held locally under `test-results/hosted-meta-test-success.png` and `test-results/vercel-integration.png`; these files are not committed because they depict account configuration.
