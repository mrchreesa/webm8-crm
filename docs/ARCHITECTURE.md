# Architecture and operational notes

## Small-stack boundaries

React + Vite browser; Express API; PostgreSQL through node-postgres or local SQLite WAL through better-sqlite3; independent Node/tsx worker. `DATABASE_URL` selects PostgreSQL, with verified TLS and a small connection pool. Without it, `DATABASE_PATH` selects SQLite. Dialect-specific migrations under `server/migrations/` are applied transactionally on startup or `npm run migrate`, once per database. No memory-only queue and no browser-driven dispatch. SQLite requires a single persistent host/volume; PostgreSQL can serve separate web and worker hosts. The current web/worker runtime still runs on the Mac with a temporary HTTPS tunnel; SQLite WAL is not suitable on network filesystems or across independent machines. Run one web process and one worker; short leases also make accidentally duplicated workers safe.

## Lead receipt and event transaction

The webhook verifies HMAC SHA-256 over the raw bytes before parsing. It transactionally stores minimal notifications in `inbox` before HTTP 200. Unique Meta lead IDs make repeat notifications idempotent. Full Graph lead retrieval is asynchronous, authenticated with a Page token and appsecret_proof. Contact data, source IDs, answers and original submission time are saved with a New milestone at the actual successful CRM receipt time. Notification receipt is separately retained. A failed retrieval remains visible/retryable; a crash after acknowledgement cannot lose the job.

Graph and webhook JSON numeric tokens are parsed losslessly as strings. Input APIs require Meta IDs as strings; both schemas use TEXT columns for all Meta IDs. Emails never identify/deduplicate separate submissions. CSV parsing disables casting. Exports quote IDs; JSON export is the precision-safe archival option. Spreadsheet auto-detection can still corrupt quoted digit strings: explicitly import every Meta ID column as Text.

Stage history, first-reached milestones and minimal outbox payload are committed in a single immediate SQL transaction. Same-stage updates return without history or event. Notes/contact edits do not queue events. New and positive milestones dispatch only once per lead. Other genuine repeat transitions dispatch. Corrections record a reason/history but skip event and milestone creation; a correction changes current state and does not undo prior attained milestones.

## Delivery guarantees

Each event snapshots its event name, UUID, actual Unix-second time, hashes, mode and dataset. Every retry sends the same payload, ID and time. A dataset can be filled in only if originally absent; an already chosen dataset cannot silently change. A test code may be rotated without changing test mode. No test/demo event is converted to live. Leads initially captured in test mode stay test-only.

The worker claims under `BEGIN IMMEDIATE` on SQLite, or a PostgreSQL transaction with a shared advisory write lock and commits a random lease token with a 60-second deadline before I/O. Requests have 20-second timeouts. Completion updates compare the lease token. Crashes reclaim expired leases; uncertain HTTP outcomes are retried with the same event ID for Meta deduplication. This is **at-least-once delivery**, not a claim of distributed exactly-once processing.

Within a lead, actual event time and stable sequence determine order. Earlier pending/processing/failed events block later events only for that lead. Accepted, expired and permanently suppressed events release later work. Different leads continue through failures. One event per request. Retry backoff starts at 30 seconds, doubles, and caps at six hours. Transient Graph codes, 429, 5xx and network timeouts retry automatically. Authentication/permission/non-transient validation failures become Failed and require an owner retry. Seven-day eligibility is rechecked before dispatch/retry; event times are never repaired. Pending/failed old events become Expired, including while mode is paused.

Only `events_received=1` becomes “Accepted by Meta”. Trace IDs and safe message-count metadata are retained, not raw remote errors that can echo credentials or PII. Matching utility is server-side only: trim/lowercase email; parse phone with GB default and explicit international codes; hash each normalised contact value once. Invalid/missing contact identifiers are omitted. Lead IDs are exact unhashed strings. No notes, answers, cookies, IP addresses, user agents or click identifiers are fabricated/sent.

## Access, deletion and backups

Every owner API except health/auth and verified webhook endpoints requires a persisted opaque session. Only SHA-256 session token hashes are stored. Sessions are bound to the configured owner email/password hash, so changing owner access invalidates them on restart even when the password reset command ran outside the production volume. SameSite=Strict HttpOnly cookies are Secure in production, with origin checks and session-bound CSRF for mutations. Login is rate limited through a shared SQL store; raw client IPs are never stored. PostgreSQL transaction callbacks use a dedicated connection and nested savepoints. The advisory write lock is held only during short transactions, never during Meta network calls. Secrets stay in environment variables. No secrets or raw API error payloads are logged. UI drafts are memory-only. Edits use optimistic version checks to avoid stale overwrites.

Deletion cascades through all lead personal data, notes, history, milestones and outbox. The matching inbox is removed. A SHA-256 marker of the original Meta ID suppresses redelivery without retaining its raw value. In-flight sends cannot be deleted until they complete; this avoids a claim that deleting local data stops an already-sent request. SQLite secure_delete is enabled and WAL is checkpointed on deletion. Database backups may still contain deleted data: rotate/encrypt/prune backups under your retention policy. This app does not promise deletion from Meta or backups it does not control.

Back up using SQLite's online backup API or `.backup` command, **never just copy the active main file and discard its WAL**. Protect the whole volume and `.env`. Restore into a stopped web/worker environment, retain event IDs, then restart. An accepted event sent after the backup could be retried on restoration; its stable ID supports deduplication. Test restoration and watch the worker heartbeat; supervisor health alone is not proof of event delivery.

For Neon migration, restore limits and the pending Vercel worker adaptation, see [NEON.md](NEON.md).

## Vercel runtime

The hosted runtime uses Neon only, private Vercel queue wakeups and bounded worker cycles. SQL remains authoritative for leases, stable payloads, ordering, retries and expiry. Daily authenticated cron recovers database commits whose publication was interrupted. Preview APIs are isolated; live delivery requires the production server lock to be enabled as well as explicit owner mode selection. See [Vercel deployment](VERCEL.md).

## Sales workflow

`server/workflow.ts` owns structured results, activity corrections and follow-up tasks; `server/lead-queries.ts` owns server-filtered queue/board projections and follow-up health reporting. Both use the existing SQL transaction/owner-auth boundaries. Migration 009 adds lead-scoped cascade-deleted tables and carries existing follow-up dates forward. The original `leads.follow_up_at` remains a transactional compatibility projection of the single open task. JSON exports and SQLite-to-PostgreSQL transfer include full task/activity history. See [sales workflow](SALES-WORKFLOW.md).
