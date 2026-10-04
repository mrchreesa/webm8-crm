CREATE TABLE queue_health (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_enqueued_at TEXT, last_processed_at TEXT, last_error TEXT
);
