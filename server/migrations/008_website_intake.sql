ALTER TABLE leads ADD COLUMN website_submission_key TEXT;
CREATE UNIQUE INDEX leads_website_submission ON leads(website_submission_key);
