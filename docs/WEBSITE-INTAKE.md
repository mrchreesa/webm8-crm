# Website enquiry intake

The website sends validated /free-demo/ enquiries to POST /api/webhooks/website.
The CRM must save the enquiry before the website reports success. Supabase remains
the store for the separate movers workflow; demo enquiries no longer split across
two operational databases.

Configure WEBSITE_INTAKE_SECRET in both Production projects only. Use a random
secret of at least 32 characters. The website also needs CRM_WEBSITE_INTAKE_URL
pointing to the permanent CRM origin plus /api/webhooks/website. The signature is
HMAC-SHA256 of the exact JSON body in x-webm8-signature-256. Secrets never enter
browser bundles. Missing configuration or an invalid signature rejects intake.

Migration 008 adds only website_submission_key and its unique index. That key
makes concurrent/replayed submissions return the same CRM ID. A deletion records
a hashed marker so retries cannot restore a deleted enquiry.

The CRM displays these records as Website demo. Internally they use the existing
manual delivery category plus an explicit website_submission_key: this preserves
their website origin while excluding them from Meta Instant Form outcome dispatch.
They have no fabricated Meta lead/Page/form IDs. Contact details, business answers,
service area and attribution are kept in the CRM and follow the normal owner
authentication, edit, note and follow-up workflow.

The website sends a standard browser Lead only after receiving a saved CRM ID,
using that ID as eventID. /demo/ remains the post-Instant-Form examples page and
never fires Lead. NEXT_PUBLIC_META_PIXEL_ID must be configured before the website
production build. Do Not Track handling remains unchanged.

Existing Meta test-only records stay test-only. Current live configuration governs
new genuine Meta leads; accepted test events are explicitly labeled in the UI.
Do not relabel historical test events or fabricate a live outcome to verify delivery.

Customer/owner email sends still depend on the website's Resend configuration.
The success page only claims an email was sent when the send result confirms it;
a missing email service does not hide a saved CRM enquiry.
