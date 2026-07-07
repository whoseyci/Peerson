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

-- Performance & Foreign Key Indexes
CREATE INDEX IF NOT EXISTS idx_household_members_user ON household_members(user_id);
CREATE INDEX IF NOT EXISTS idx_items_household ON items(household_id);
CREATE INDEX IF NOT EXISTS idx_batches_item ON batches(item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_household ON tasks(household_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_expenses_household ON expenses(household_id);
CREATE INDEX IF NOT EXISTS idx_expenses_paid_by ON expenses(paid_by);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense ON expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);
CREATE INDEX IF NOT EXISTS idx_shopping_items_household ON shopping_items(household_id);
CREATE INDEX IF NOT EXISTS idx_shopping_items_linked ON shopping_items(linked_item_id);

-- Price Tracking Columns
ALTER TABLE batches ADD COLUMN price REAL DEFAULT NULL;
ALTER TABLE shopping_items ADD COLUMN price REAL DEFAULT NULL;

-- Tasks Recurrence & Rotation Columns
ALTER TABLE tasks ADD COLUMN recurrence TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN rotation_users TEXT DEFAULT NULL;

-- Expenses Category Column
ALTER TABLE expenses ADD COLUMN category TEXT DEFAULT 'sonstiges';

-- Per-Batch Location Column
-- A batch can live somewhere more specific than (or different from) its
-- parent item's own location_id -- e.g. "Milch" the item is nominally
-- shelved in the kitchen fridge, but one batch someone just bought is
-- still sitting in a garage fridge. NULL means "inherit the item's own
-- location_id" (the pre-existing, single-location-per-item behavior),
-- so every batch written before this column existed keeps behaving
-- exactly as before with zero backfill required.
ALTER TABLE batches ADD COLUMN location_id TEXT REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_batches_location ON batches(location_id);

-- Consumption Prediction Columns
-- Fully consumed batches are retained at quantity=0 instead of hard-deleted.
-- initial_quantity records the restocked quantity for new batches; consumed_at
-- records when the batch first reached zero. Together with date_added, this
-- provides a simple restocked-to-empty cycle history for consumption forecasts.
ALTER TABLE batches ADD COLUMN initial_quantity INTEGER DEFAULT NULL;
ALTER TABLE batches ADD COLUMN consumed_at INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_batches_consumed_at ON batches(item_id, consumed_at);

-- Task Completion Log
-- Every time a task is marked done (including each cycle of a recurring
-- task's rotation), one row is appended here recording who did it and
-- when. This is intentionally an append-only log, separate from the
-- tasks table itself (which only ever reflects *current* status/assignee)
-- -- it exists purely to answer "who's actually been doing the work"
-- (the People view's fairness summary) without trying to reconstruct
-- history from a table that overwrites itself on every completion.
CREATE TABLE IF NOT EXISTS task_completions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  completed_by TEXT NOT NULL REFERENCES users(id),
  completed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_task_completions_household ON task_completions(household_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_user ON task_completions(completed_by);

-- Household-level monthly budgets per real expense category
CREATE TABLE IF NOT EXISTS category_budgets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  monthly_amount REAL NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_budgets_household_category
  ON category_budgets(household_id, category);

-- Task Subtasks (Checklists)
ALTER TABLE tasks ADD COLUMN subtasks TEXT DEFAULT NULL;

-- Web Push subscriptions and notification deduplication log
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_household ON push_subscriptions(household_id);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_notification_log_dedupe ON notification_log(household_id, dedupe_key);
