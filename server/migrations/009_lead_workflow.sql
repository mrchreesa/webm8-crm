CREATE TABLE lead_tasks (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('call','demo','proposal','other')),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','completed','cancelled')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  completed_at TEXT, cancelled_at TEXT
);
CREATE UNIQUE INDEX one_open_task_per_lead ON lead_tasks(lead_id) WHERE status='open';
CREATE INDEX tasks_due ON lead_tasks(status,due_at,lead_id);
CREATE TABLE lead_activities (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL,
  scheduled_for TEXT, previous_due_at TEXT,
  task_id TEXT REFERENCES lead_tasks(id) ON DELETE SET NULL,
  request_hash TEXT, voided_at TEXT, void_reason TEXT
);
CREATE INDEX activities_lead ON lead_activities(lead_id,occurred_at,recorded_at);
INSERT INTO lead_tasks (id,lead_id,title,kind,due_at,status,created_at,updated_at)
  SELECT 'legacy-follow-up:' || id,id,'Follow up','call',follow_up_at,
    CASE WHEN stage IN ('Won','Lost','Unqualified') THEN 'cancelled' ELSE 'open' END,
    updated_at,updated_at
  FROM leads WHERE follow_up_at IS NOT NULL;
INSERT INTO lead_activities (id,lead_id,kind,note,occurred_at,recorded_at,actor,scheduled_for,task_id)
  SELECT 'legacy-follow-up:' || id,id,'follow_up_scheduled',
    'Existing follow-up carried over. Original scheduling time was not recorded.',
    updated_at,updated_at,'Migration',follow_up_at,'legacy-follow-up:' || id
  FROM leads WHERE follow_up_at IS NOT NULL;

-- Closed leads keep the historical task, without an active reminder.
UPDATE leads SET follow_up_at=NULL WHERE stage IN ('Won','Lost','Unqualified');
