# Neon database and hosting

The WebM8 CRM database is on **Neon Free**, AWS Europe West 2 (London), PostgreSQL 18. Project: `green-poetry-45355974`; database: `webm8_crm`; default branch: `production`. The web server and persistent worker still run locally behind the temporary HTTPS tunnel. This database change does not constitute a Vercel deployment. Meta delivery stays in **test mode** until the owner explicitly enables Live after hosting is ready.

## Server configuration

`DATABASE_URL` is the pooled Neon connection string. Store it only in the server's private environment or hosting secret configuration. Never put it in frontend code, a `VITE_` variable, command arguments, screenshots, logs or Git. The adapter verifies the server's TLS certificate, uses a small pool, keeps Meta IDs as TEXT, and applies PostgreSQL migrations transactionally. Web and worker must receive the same database URL and existing Meta configuration. Local SQLite remains available when `DATABASE_URL` is blank.

## Migrating an existing SQLite installation

1. Stop web and worker, allowing any active retrieval/delivery to finish. Keep a private SQLite online backup, including a restorable snapshot of the previous configuration.
2. Create an empty PostgreSQL database and set its URL privately. Never run the transfer against a populated database.
3. Run `npm run migrate:neon`. Alternatively use `npm run migrate:neon -- --connection-file /private/path/connection.txt`; this avoids placing credentials in shell arguments. The source remains `DATABASE_PATH`.
4. The transfer copies leads, history, milestones, notes, outbox, inbox, sessions, deletion markers, imports and settings in one destination transaction. Every copied row is checked before commit; failure rolls back the copied records. Existing processing jobs cause migration to refuse until they finish. Sequence counters are advanced beyond copied IDs. Re-running an identical source reports already migrated instead of importing it again.
5. Start both services with `DATABASE_URL` set. Verify owner login, original IDs, export, accepted event IDs/times/attempts, integration mode and worker heartbeat. Do not seed demo records or recreate stages during migration.

The current cutover retained the two genuine Meta test leads and their two already accepted New events. They were not dispatched again. A private pre-cutover SQLite backup remains under `data/backups/`.

## Free-plan operation and backups

Free plans have storage, compute and restore limits; check the actual project allowance in Neon rather than assuming unlimited capacity. The project console showed a six-hour history window at setup. Maintain independent private exports/backups and test restoration; that window is not long-term backup retention. Native PostgreSQL backups can be made with `pg_dump` using a private environment/connection configuration. Backup retention must cover deletion requirements too.

Continuous polling keeps the database compute active. The current local worker polls frequently for prompt test delivery; leaving it on continuously can consume the free compute allowance. Before permanent Vercel deployment, replace its infinite loop with durable queue-triggered bounded processing, while retaining SQL inbox/outbox records, leases, stable event IDs, original timestamps, per-lead order and seven-day expiry. Use a recovery mechanism for committed jobs whose queue publication fails. Vercel Hobby's daily cron alone is not adequate for prompt delivery and retries.

The React assets and Express API also need Vercel deployment configuration. Database hosting alone does not make the callback independent of this Mac. Update Meta's callback only after the permanent HTTPS endpoint is verified. Keep Live off during cutover and test with a genuine Meta test lead after deployment.
