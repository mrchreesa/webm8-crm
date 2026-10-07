# Possible website visits on a CRM lead

The owner's 7 October 2026 instruction is to compare visit timing and other available evidence, without requiring a personal link or another form. This feature is a comparison, not a named visitor identification system. No matching associations are stored and nothing is sent to Meta by this report.

The owner confirms `/demo` is the Instant Form destination; the normal website enquiry flow uses `/free-demo`. The route is therefore evidence of the intended funnel even when referrer and campaign tags are missing. It does not identify a particular lead or prove a paid click.

For a real Meta Instant Form lead, Website activity compares `/demo` sessions first received from two minutes before to ten minutes after the Meta submission time. CRM receipt time is an explicitly labelled fallback only. Database receipt timestamps determine comparison windows, so an incorrect browser clock cannot improve a match. A visitor's measurement choice or a network delay can move first receipt later than actual arrival. The panel can therefore miss a real visit.

Exact ad ID, ad set ID and campaign ID matches in the landing URL provide additional evidence, in that order. IDs stay strings. Conflicting identifiers are shown and ranked last. Meta source/referrer and a click-marker boolean provide weaker evidence. A Meta click marker alone is neither a paid-ad confirmation nor a lead identifier. A visit that also fits other nearby leads says so. Device category is context only: the Meta intake does not supply a browser identifier for comparison. There is no IP matching, fingerprinting, cross-device joining, percentage confidence or inferred name/email/phone.

The first observed page of the whole candidate session must be `/demo`; a later `/demo` view cannot disguise an older visit. Inspecting a possible visit shows that measured browser session's pages, active and visible time, scroll reach and timestamped click labels. External iframe/demo sites are outside the collector's coverage. Other sessions are available in the existing Analytics browser explorer, but are not automatically assigned to this lead.

## Access and limits

Set `CRM_ANALYTICS_SITE_ID` to the registered WebM8 site in `CRM_WORKSPACE_ID`. The existing authenticated workspace session supplies its user-scoped Supabase client to this read-only route. Site and workspace predicates are applied to every query and Supabase RLS remains enforced. The service key is never used for ordinary CRM reporting. Demo/other-source leads do not query real visitor data. Arbitrary non-candidate session IDs are rejected.

The search considers up to 200 landing rows, 50 distinct candidate sessions and 200 nearby leads, and reports incomplete results if any limit is reached. Candidate pages contain five visits; detail pages contain 25 page views. The panel refreshes every 20 seconds while visible, including arrivals measured after opening a new lead. Requests are independent of lead capture and delivery. Analytics errors stay in this panel with Retry. The query does not copy contact details into Analytics or duplicate telemetry in the CRM database.

WebM8's website loads the tracker only after activity measurement is allowed, honours DNT/GPC, and explains the timing comparison. The existing 180-day analytics retention bounds this view. Withdrawal stops future collection and clears browser identifiers; previously collected pseudonymous records remain subject to existing retention. No permanent lead/session association requires later removal. Deleting a lead removes the CRM record used for comparison.

## Verification

`npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run build`. The browser test covers candidate evidence, mobile layout, accessibility, page history, failure/empty states and preserving an unsaved note. `scripts/verify-website-activity.ts` uses disposable Supabase sites/accounts and an in-memory CRM database to verify the deployed collector, real RLS reads, competing leads, foreign-workspace rejection and session boundaries. It sends no messages or Meta events and removes its fixtures.
