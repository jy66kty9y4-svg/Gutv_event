PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portal_vk_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  published_at INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  image_alt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (group_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_portal_vk_posts_published
ON portal_vk_posts(published_at DESC, post_id DESC);

PRAGMA optimize;
