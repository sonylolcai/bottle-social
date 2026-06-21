CREATE TABLE users (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  language TEXT NOT NULL,
  region TEXT NOT NULL,
  is_adult INTEGER NOT NULL CHECK (is_adult IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL
);

CREATE TABLE personality_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  openness INTEGER NOT NULL CHECK (openness BETWEEN 1 AND 5),
  energy INTEGER NOT NULL CHECK (energy BETWEEN 1 AND 5),
  warmth INTEGER NOT NULL CHECK (warmth BETWEEN 1 AND 5),
  curiosity INTEGER NOT NULL CHECK (curiosity BETWEEN 1 AND 5),
  pace INTEGER NOT NULL CHECK (pace BETWEEN 1 AND 5),
  updated_at TEXT NOT NULL
);

CREATE TABLE bottles (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  content TEXT,
  content_hash TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('rejected', 'approved', 'delivered', 'expired')),
  rejection_code TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CONSTRAINT bottles_lifecycle CHECK (
    (status IN ('approved', 'delivered') AND content IS NOT NULL)
    OR (status = 'rejected' AND rejection_code IS NOT NULL)
    OR status = 'expired'
  )
);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  bottle_id TEXT NOT NULL REFERENCES bottles(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('available', 'pulled', 'expired', 'reported')),
  created_at TEXT NOT NULL,
  pulled_at TEXT,
  expires_at TEXT NOT NULL,
  UNIQUE (bottle_id, recipient_id)
);

CREATE TABLE replies (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  from_user_id TEXT NOT NULL REFERENCES users(id),
  to_user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('rejected', 'available', 'pulled', 'expired', 'reported')),
  rejection_code TEXT,
  created_at TEXT NOT NULL,
  pulled_at TEXT,
  expires_at TEXT NOT NULL,
  CONSTRAINT replies_lifecycle CHECK (
    (status IN ('available', 'pulled', 'reported') AND content IS NOT NULL)
    OR (status = 'rejected' AND rejection_code IS NOT NULL)
    OR status = 'expired'
  )
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('bottle', 'reply')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  input_hash TEXT,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_deliveries_recipient_status_expires_at ON deliveries(recipient_id, status, expires_at);
CREATE INDEX idx_replies_to_user_status_expires_at ON replies(to_user_id, status, expires_at);
CREATE INDEX idx_bottles_status_language_expires_at ON bottles(status, language, expires_at);
CREATE INDEX idx_bottles_sender_created_at ON bottles(sender_id, created_at);
CREATE INDEX idx_reports_target ON reports(target_type, target_id);
CREATE INDEX idx_audit_events_target_created_at ON audit_events(target_type, target_id, created_at);
