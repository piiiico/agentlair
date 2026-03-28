CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  account_id TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'account',
  actor_id TEXT NOT NULL,
  actor_ip_hash TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  status INTEGER NOT NULL,
  result TEXT NOT NULL,
  error_code TEXT,
  details TEXT,
  prev_hash TEXT NOT NULL,
  signature TEXT NOT NULL
);

CREATE INDEX idx_audit_account_ts ON audit_log(account_id, timestamp);
CREATE INDEX idx_audit_category_ts ON audit_log(category, timestamp);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, timestamp);
CREATE INDEX idx_audit_result ON audit_log(result, timestamp);
