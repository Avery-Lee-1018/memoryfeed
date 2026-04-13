PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_sources (
  user_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  level TEXT NOT NULL DEFAULT 'focus' CHECK (level IN ('core', 'focus', 'light')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, source_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_feed_slots (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  slot_index INTEGER NOT NULL CHECK (slot_index IN (0, 1, 2)),
  item_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date, slot_index),
  UNIQUE (user_id, date, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_feed_slots_user_date ON user_feed_slots(user_id, date);
CREATE INDEX IF NOT EXISTS idx_user_feed_slots_user_source_date ON user_feed_slots(user_id, source_id, date);

CREATE TABLE IF NOT EXISTS user_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_notes_user_item ON user_notes(user_id, item_id);

CREATE TABLE IF NOT EXISTS user_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('keep', 'skip')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_reactions_user_item ON user_reactions(user_id, item_id);
