CREATE TABLE login_limits (key_hash TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX login_limits_expiry ON login_limits(expires_at);
