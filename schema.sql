-- Peerson D1 Schema

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (household_id, user_id)
);

-- Nested storage locations (e.g. "Küche" -> "Rollcontainer" -> "oben"),
-- managed per-household in Settings. Modeled as a plain adjacency list
-- (id + parent_id) rather than a path string, materialized-path column, or
-- nested-set model -- with a household's location count realistically in
-- the dozens (a handful of rooms x a handful of containers x a handful of
-- positions), an adjacency list needs no rebalancing/rewriting on
-- insert/move/rename (each is a single-row write), and the whole tree for
-- a household is cheap to pull in one indexed query and assemble into a
-- tree client-side. A materialized-path or nested-set model only pays for
-- itself at a scale (thousands of nodes, frequent subtree-range queries)
-- this app will never approach.
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_locations_household ON locations(household_id);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'sonstiges',
  icon TEXT,
  threshold INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  barcodes TEXT DEFAULT '[]',
  nutrition TEXT DEFAULT '{}',
  price_cents INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Price history is deliberately NOT one row per purchase/batch -- that
-- would grow unbounded and mostly store the same number over and over.
-- Instead items.price_cents always holds the *current* price, and a new
-- history row is only appended when a price actually *changes* (the old
-- price gets its effective_until stamped and becomes an immutable history
-- entry). This directly answers "what did this cost before / how much did
-- it go up" (inflation tracking) with a handful of rows per item over its
-- whole lifetime instead of one per purchase.
CREATE TABLE IF NOT EXISTS item_price_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL,
  effective_from INTEGER NOT NULL DEFAULT (unixepoch()),
  effective_until INTEGER
);
CREATE INDEX IF NOT EXISTS idx_item_price_history_item ON item_price_history(item_id);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  expiry TEXT,
  barcode_code TEXT,
  grams_per_unit INTEGER DEFAULT 0,
  date_added INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'todo',
  due_date TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_by TEXT NOT NULL REFERENCES users(id),
  split_type TEXT NOT NULL DEFAULT 'equal',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS expense_splits (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity TEXT,
  requested_by TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  linked_item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
