PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portal_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('faculty', 'organization')),
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 2 AND 120),
  representative_name TEXT NOT NULL CHECK (length(representative_name) BETWEEN 2 AND 120),
  contact TEXT NOT NULL CHECK (length(contact) BETWEEN 3 AND 120),
  telegram_chat_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'blocked')),
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_organizations_name ON portal_organizations(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_portal_organizations_status ON portal_organizations(status, created_at);

CREATE TABLE IF NOT EXISTS portal_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 60),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'requester' CHECK (role IN ('requester', 'management')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'blocked')),
  organization_id INTEGER REFERENCES portal_organizations(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 120),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_username ON portal_accounts(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_portal_accounts_organization ON portal_accounts(organization_id, status);

CREATE TABLE IF NOT EXISTS portal_specialties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 2 AND 80),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_specialties_name ON portal_specialties(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS portal_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES portal_organizations(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL REFERENCES portal_accounts(id) ON DELETE RESTRICT,
  event_title TEXT NOT NULL CHECK (length(event_title) BETWEEN 2 AND 160),
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  location TEXT NOT NULL CHECK (length(location) BETWEEN 2 AND 240),
  event_description TEXT NOT NULL CHECK (length(event_description) BETWEEN 10 AND 4000),
  requested_equipment TEXT NOT NULL CHECK (length(requested_equipment) BETWEEN 2 AND 2000),
  assigned_equipment TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL CHECK (length(contact_name) BETWEEN 2 AND 120),
  contact_channel TEXT NOT NULL CHECK (length(contact_channel) BETWEEN 3 AND 120),
  customer_comment TEXT NOT NULL DEFAULT '',
  internal_comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'clarification', 'approved', 'in_progress', 'completed', 'rejected', 'cancelled')),
  closing_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portal_applications_org_date ON portal_applications(organization_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_portal_applications_status_date ON portal_applications(status, event_date);

CREATE TABLE IF NOT EXISTS portal_application_specialists (
  application_id INTEGER NOT NULL REFERENCES portal_applications(id) ON DELETE CASCADE,
  specialty_id INTEGER NOT NULL REFERENCES portal_specialties(id) ON DELETE RESTRICT,
  requested_count INTEGER NOT NULL CHECK (requested_count BETWEEN 1 AND 99),
  assigned_count INTEGER NOT NULL DEFAULT 0 CHECK (assigned_count BETWEEN 0 AND 99),
  assigned_names TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (application_id, specialty_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_application_specialists_specialty ON portal_application_specialists(specialty_id, application_id);

CREATE TABLE IF NOT EXISTS portal_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES portal_applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portal_status_history_application ON portal_status_history(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portal_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL UNIQUE REFERENCES portal_applications(id) ON DELETE RESTRICT,
  organization_id INTEGER NOT NULL REFERENCES portal_organizations(id) ON DELETE RESTRICT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portal_reviews_organization ON portal_reviews(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portal_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES portal_organizations(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES portal_applications(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portal_notifications_organization ON portal_notifications(organization_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS portal_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES portal_applications(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 240),
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 120),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_portal_attachments_application ON portal_attachments(application_id);

INSERT OR IGNORE INTO portal_specialties (name, sort_order) VALUES
  ('Оператор', 10),
  ('Фотограф', 20),
  ('Звукорежиссёр', 30),
  ('Специалист по свету', 40),
  ('Режиссёр трансляции', 50),
  ('Монтажёр', 60);

PRAGMA optimize;
